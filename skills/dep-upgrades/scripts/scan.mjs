#!/usr/bin/env node
// Usage: node scan.mjs [project-root] [--cooldown <days>] [--out <dir>] [--eco npm|PyPI|Go]
// Finds npm, Python, and Go manifests, checks every direct dependency against its registry,
// OSV (CVEs, CWEs, fixed versions, malware), and its release notes, and checks every
// locked package for vulnerabilities. Prints a compact report to stdout and writes
// <out>/report.json plus one release-notes file per upgrade to <out>/notes/.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  bumpKind, chooseTarget, compareVersions, flagLines, maxSeverity, osvScan, pool, releaseNotes, severityOf, WAIT,
} from "./lib.mjs";
import * as npm from "./npm.mjs";
import * as pypi from "./pypi.mjs";
import * as go from "./go.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const cooldown = Number(flag("--cooldown", 14));
const onlyEco = flag("--eco", null);
const outFlag = flag("--out", null);
const root = resolve(args[0] ?? process.cwd());
const out = resolve(outFlag ?? join(process.env.TMPDIR ?? tmpdir(), "dep-upgrades", basename(root)));
const managers = [npm, pypi, go].filter((m) => !onlyEco || m.ecosystem.toLowerCase() === onlyEco.toLowerCase());

const projects = managers.flatMap((m) => m.discover(root).map((p) => ({ ...p, manager: m })));
if (!projects.length) {
  console.log(`no npm, Python, or Go manifests under ${root}`);
  process.exit(0);
}

// ---------- registry + OSV ----------

const directKeys = new Map();
for (const p of projects) {
  for (const d of p.direct) {
    if (!d.version) continue;
    const key = `${p.ecosystem}|${d.name}|${d.version}`;
    if (!directKeys.has(key)) directKeys.set(key, { ecosystem: p.ecosystem, manager: p.manager, dep: d, projects: [] });
    directKeys.get(key).projects.push(p);
  }
}
const directs = [...directKeys.values()];
await pool(directs, 8, async (e) => { e.meta = await e.manager.registry(e.dep.name).catch((err) => ({ error: err.message })); });

const osv = await osvScan([
  ...directs.map((e) => ({ ecosystem: e.ecosystem, name: e.dep.name, version: e.dep.version })),
  ...projects.flatMap((p) => p.locked.map((l) => ({ ecosystem: p.ecosystem, ...l }))),
]);

// ---------- per direct dependency ----------

rmSync(join(out, "notes"), { recursive: true, force: true });
mkdirSync(join(out, "notes"), { recursive: true });

const packages = await pool(directs, 6, async ({ ecosystem, dep, meta, projects: projs, manager }) => {
  const base = { ecosystem, name: dep.name, current: dep.version, kind: dep.kind, pinned: dep.pinned, spec: dep.spec, manifests: projs.map((p) => p.manifest) };
  const vulns = osv.get(`${ecosystem}|${dep.name}|${dep.version}`) ?? [];
  if (!meta || meta.error) return { ...base, error: meta?.error ?? "not found in registry", vulns, ...severityOf({ vulns }) };
  const commandsFor = (version) => projs.map((p) => `cd ${p.dir} && ${manager.upgradeCommand(dep, version, p)}`);
  const own = meta.versions.find((v) => compareVersions(v.version, dep.version) === 0);
  const t = chooseTarget({ current: dep.version, versions: meta.versions, vulns, cooldownDays: cooldown });
  // Go: a new major is a new module path, so the registry reports it separately.
  if (meta.majors) t.majorsBehind = meta.majors.length;
  const deprecated = !!(own?.deprecated || meta.deprecated);
  const sev = severityOf({ vulns, deprecated, yanked: own?.yanked, ...t });
  const pkg = {
    ...base, ...t, ...sev, vulns, repo: meta.repo,
    deprecated, yanked: !!own?.yanked,
    ...(meta.majors?.length ? { nextMajor: meta.majors.at(-1) } : {}),
    bump: t.target ? bumpKind(dep.version, t.target) : "none",
    commands: t.target ? commandsFor(t.target) : [],
    commandsInMajor: t.inMajor && t.inMajor !== t.target ? commandsFor(t.inMajor) : [],
  };
  if (!t.target) return pkg;
  const notes = await releaseNotes({ repo: meta.repo, name: dep.name, from: dep.version, to: t.target }).catch(() => ({ source: null, entries: [] }));
  const flags = flagLines(notes.entries);
  pkg.notesSource = notes.source;
  pkg.notesError = notes.error ?? null;
  pkg.breaking = { major: pkg.bump === "major", lines: flags.breaking.length };
  pkg.securityLines = flags.security.length;
  if (notes.entries.length) {
    pkg.notes = join(out, "notes", `${ecosystem}__${dep.name.replace(/[@/]/g, "_")}.md`);
    const text = notes.entries.map((e) => `## ${e.version}\n\n${e.body}`).join("\n\n");
    writeFileSync(pkg.notes, `# ${dep.name} ${dep.version} -> ${t.target} (${notes.source})\n\n${text.slice(0, 60_000)}\n`);
    pkg.flagged = { breaking: flags.breaking.slice(0, 20), security: flags.security.slice(0, 20) };
  }
  return pkg;
});

// ---------- transitive vulnerabilities ----------


const transitive = new Map();
for (const p of projects) {
  for (const l of p.locked) {
    const key = `${p.ecosystem}|${l.name}|${l.version}`;
    const vulns = osv.get(key);
    if (!vulns || directKeys.has(key)) continue;
    if (!transitive.has(key)) transitive.set(key, { ecosystem: p.ecosystem, name: l.name, current: l.version, vulns, ...severityOf({ vulns }), lockfiles: [] });
    transitive.get(key).lockfiles.push(p.lockfile);
  }
}

// ---------- hygiene ----------

const hygiene = projects.map((p) => ({
  manifest: p.manifest,
  lockfile: p.lockfile,
  lockStatus: p.lockStatus,
  unpinned: p.direct.filter((d) => !d.pinned).map((d) => `${d.name}@${d.spec}`),
  unresolved: p.direct.filter((d) => !d.version).map((d) => d.name),
  skipped: p.skipped,
}));

const report = {
  root, date: new Date().toISOString().slice(0, 10), cooldownDays: cooldown,
  severity: maxSeverity([...packages, ...transitive.values()].map((p) => p.severity)),
  packages, transitive: [...transitive.values()], hygiene,
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));

// ---------- compact stdout ----------

const ORDER = ["critical", "high", "medium", "low", "none"];
const bySeverity = (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.name.localeCompare(b.name);
const vulnLine = (v) => `  vuln ${v.id}${v.cve.length ? ` ${v.cve.join(",")}` : ""} ${v.severity}${v.cwe.length ? ` ${v.cwe.join(",")}` : ""} fix ${v.fixed ?? "none"}: ${v.summary}`;
// At most 5 vuln lines per package; the rest is in report.json.
const vulnLines = (vulns) => {
  const shown = vulns.slice(0, 5).map(vulnLine);
  const rest = vulns.slice(5);
  if (rest.length) {
    const counts = [...ORDER, "unknown"].map((l) => [l, rest.filter((v) => v.severity === l).length]).filter(([, n]) => n).map(([l, n]) => `${n} ${l}`);
    shown.push(`  +${rest.length} more vulns (${counts.join(", ")}), highest fix ${rest.map((v) => v.fixed).filter(Boolean).sort(compareVersions).at(-1) ?? "none"}`);
  }
  return shown;
};
const lines = [`dep-upgrades ${report.date} severity=${report.severity} cooldown=${cooldown}d report=${join(out, "report.json")}`];
for (const h of hygiene) {
  const p = projects.find((x) => x.manifest === h.manifest);
  lines.push(`${p.ecosystem} ${h.manifest} (${h.lockStatus}): ${p.direct.length} direct, ${p.locked.length} locked, ${h.unpinned.length} unpinned, ${h.unresolved.length} unresolved${h.skipped.length ? `, ${h.skipped.length} non-registry` : ""}`);
}
const actionable = packages.filter((p) => p.severity !== "none" || p.error).sort(bySeverity);
for (const p of actionable) {
  if (p.error) { lines.push(`[${p.severity}] ${p.ecosystem} ${p.name} ${p.current}: ERROR ${p.error}`); lines.push(...vulnLines(p.vulns)); continue; }
  const to = p.remove ? "-> REMOVE (malicious, no safe version)" : p.target ? `-> ${p.target}${p.fresh ? " (fresh, inside cooldown)" : ""}` : p.nextMajor && !p.releasesBehind ? "-> current in its major" : "-> hold (no cooled release)";
  const inMajor = p.inMajor && p.inMajor !== p.target ? ` in-major ${p.inMajor}` : p.nextMajor ? ` new major ${p.nextMajor.path}@${p.nextMajor.latest}` : "";
  lines.push(`[${p.severity}] ${p.ecosystem} ${p.name} ${p.current} ${to}${inMajor} latest ${p.latest} | ${p.bump}, ${p.releasesBehind} rel, ${p.lagDays}d behind | wait ${p.wait} | ${p.reasons.join("; ")}`);
  lines.push(...vulnLines(p.vulns));
  if (p.breaking && (p.breaking.major || p.breaking.lines)) lines.push(`  breaking: ${[p.breaking.major && "major bump", p.breaking.lines && `${p.breaking.lines} note lines`].filter(Boolean).join(", ")}`);
  if (p.notes) lines.push(`  notes ${p.notes}${p.securityLines ? ` (${p.securityLines} security lines)` : ""}`);
  else if (p.target) lines.push(`  notes: none found${p.repo ? ` in ${p.repo}` : " (no GitHub repo)"}${p.notesError ? ` (${p.notesError})` : ""}`);
}
const current = packages.filter((p) => p.severity === "none" && !p.error).length;
if (current) lines.push(`${current} packages current`);
if (transitive.size) {
  lines.push("transitive:");
  for (const t of [...transitive.values()].sort(bySeverity)) {
    lines.push(`[${t.severity}] ${t.ecosystem} ${t.name} ${t.current} (${t.lockfiles.join(", ")})`);
    lines.push(...vulnLines(t.vulns));
  }
}
for (const h of hygiene) {
  if (h.lockStatus === "missing" && h.unpinned.length) lines.push(`supply-chain: ${h.manifest} has no lockfile and ${h.unpinned.length} unpinned: ${h.unpinned.join(", ")}`);
  if (h.unresolved.length) lines.push(`not-checked: ${h.manifest} (${h.lockStatus}) ${h.unresolved.length} packages without a resolved version: ${h.unresolved.join(", ")}`);
}
console.log(lines.join("\n"));

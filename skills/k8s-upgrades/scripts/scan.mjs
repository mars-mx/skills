#!/usr/bin/env node
// Usage: node scan.mjs --context <ctx> [--repo <dir>] [--cooldown <days>] [--target <minor>] [--out <dir>]
//                      [--config <k8s-upgrades.json>] [--cluster <name>] [--snapshot <file>] [--save-snapshot <file>]
// Read-only. Snapshots the cluster with kubectl get, detects the distro, and checks the control
// plane, nodes, and add-ons against release data, endoflife.date, the official Kubernetes CVE
// feed, OSV, and the removed-API list. Prints a compact report and writes <out>/report.json
// plus release-note extracts to <out>/notes/.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  bumpKind, changelogExtract, compareVersions, cveAffects, DAY, endOfLife, eolStatus, fixFor, getJSON, getText, githubReleases,
  manifestKinds, maxSeverity, minorNum, minorOf, parseCve, parsePluto, parseVersion, pool, readyForMinor, removedBy, severityOf,
  skewFindings, upgradePath, WAIT,
} from "./lib.mjs";
import { apiserverVersions, deprecatedApiMetrics, detectDistro, haChecks, MANAGED, nodeInfo, snapshot } from "./cluster.mjs";
import { CRD_COMPONENTS, goModule, inventory } from "./components.mjs";
import { osvGo } from "./osv.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const configPath = flag("--config", existsSync("k8s-upgrades.json") ? "k8s-upgrades.json" : null);
const config = configPath ? JSON.parse(readFileSync(configPath, "utf8")) : { clusters: [] };
const clusterName = flag("--cluster", null);
const cfg = config.clusters?.find((c) => c.name === clusterName || c.context === clusterName) ?? {};
const context = flag("--context", cfg.context ?? null);
const repo = resolve(flag("--repo", process.cwd()));
const cooldown = Number(flag("--cooldown", 14));
const maxMinor = flag("--target", null);
const snapFile = flag("--snapshot", null);
const saveSnap = flag("--save-snapshot", null);
const name = cfg.name ?? context ?? "cluster";
const out = resolve(flag("--out", join(process.env.TMPDIR ?? tmpdir(), "k8s-upgrades", name)));
if (!context && !snapFile) { console.error("usage: scan.mjs --context <ctx> (or --cluster <name> from k8s-upgrades.json)"); process.exit(2); }

const snap = snapFile ? JSON.parse(readFileSync(snapFile, "utf8")) : snapshot(context);
if (saveSnap) writeFileSync(saveSnap, JSON.stringify(snap));
const distro = cfg.distro ?? detectDistro(snap);
const nodes = nodeInfo(snap);
const apiservers = apiserverVersions(snap, distro);
const current = [...apiservers].sort(compareVersions)[0];
const now = Date.now();

rmSync(join(out, "notes"), { recursive: true, force: true });
mkdirSync(join(out, "notes"), { recursive: true });
const note = (file, text) => { const p = join(out, "notes", file); writeFileSync(p, text); return p; };

// ---------- control plane: path, EOL, CVEs ----------

const EOL_PRODUCT = { eks: "amazon-eks", gke: "google-kubernetes-engine", aks: "azure-kubernetes-service" };
const DISTRO_REPO = { k3s: "k3s-io/k3s", rke2: "rancher/rke2" };
const [eolCycles, k8sCycles, feed, pluto] = await Promise.all([
  endOfLife(EOL_PRODUCT[distro] ?? "kubernetes"),
  EOL_PRODUCT[distro] ? endOfLife("kubernetes") : null,
  getJSON("https://kubernetes.io/docs/reference/issues-security/official-cve-feed/index.json").catch(() => null),
  getText("https://raw.githubusercontent.com/FairwindsOps/pluto/master/versions.yaml"),
]);

let releases;
if (MANAGED.has(distro)) {
  // Managed: the provider decides which versions exist; endoflife.date lists its cycles.
  releases = eolCycles.filter((c) => c.releaseDate).map((c) => ({ version: `${c.cycle}.1`, time: c.releaseDate, cycle: c.cycle }))
    .sort((a, b) => compareVersions(a.version, b.version));
} else {
  releases = await githubReleases(DISTRO_REPO[distro] ?? "kubernetes/kubernetes").catch(() => []);
}
const path = upgradePath({ current: MANAGED.has(distro) ? `${minorOf(current)}.0` : current, releases, cooldownDays: cooldown, now, maxMinor });
if (MANAGED.has(distro)) { path.steps = path.steps.map(minorOf); path.target = path.steps.at(-1) ?? null; path.patch = null; }
const targetMinor = path.target ? minorOf(path.target) : minorOf(current);
const eol = eolStatus(eolCycles, current, now);

const cves = (feed?.items ?? []).map(parseCve);
const coreVersions = [...new Set([...apiservers, ...nodes.map((n) => n.kubelet)])];
const clusterCves = cves.flatMap((c) => {
  const hit = coreVersions.filter((v) => ["kube-apiserver", "kubelet", "kube-controller-manager", "kube-scheduler", "kube-proxy", "kubernetes"].some((comp) => cveAffects(c, comp, v)));
  if (!hit.length) return [];
  const comps = [...new Set(c.ranges.map((r) => r.component))];
  return [{ id: c.id, severity: c.severity, components: comps, versions: hit, fixed: fixFor(c, comps[0], current), summary: c.summary, url: c.url }];
});

const skewNow = skewFindings({ apiservers, nodes });
const stepChecks = path.steps.map((v, i) => ({
  to: v,
  blockers: i === 0 ? readyForMinor({ apiservers, nodes, target: minorOf(v) }) : [],
}));

const clusterSev = severityOf({ eol, cves: clusterCves, minorsBehind: path.minorsBehind, patchesBehind: path.patchesBehind, skew: skewNow });

// Release notes per minor in the path: upstream "Urgent Upgrade Notes", deprecations, API changes.
const notes = {};
await pool(path.steps.map(minorOf), 3, async (m) => {
  const text = await getText(`https://raw.githubusercontent.com/kubernetes/kubernetes/master/CHANGELOG/CHANGELOG-${m}.md`);
  const ex = text && changelogExtract(text, m);
  if (ex) notes[`kubernetes-${m}`] = note(`kubernetes-${m}.md`, `# Kubernetes ${m}.0: upgrade notes\n\n${ex.slice(0, 80_000)}\n`);
});
if (DISTRO_REPO[distro]) {
  for (const v of [path.patch, ...path.steps].filter(Boolean)) {
    const r = releases.find((x) => x.version === v);
    if (r?.body) notes[`${distro}-${v}`] = note(`${distro}-${v.replace(/[+]/g, "_")}.md`, `# ${distro} ${v}\n\n${r.body.slice(0, 40_000)}\n`);
  }
}

// ---------- removed APIs ----------

const removed = pluto ? removedBy(parsePluto(pluto), minorOf(current), targetMinor) : [];
const metricHits = (deprecatedApiMetrics(snap.metrics) ?? []).filter((m) => compareVersions(m.removedRelease, `${targetMinor}.999`) <= 0);
const SKIP = new Set(["node_modules", ".git", "vendor", ".terraform", "dist", "build"]);
const yamls = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(d, e.name)); } else if (/\.(ya?ml)$/.test(e.name)) yamls.push(join(d, e.name)); } };
if (existsSync(repo)) walk(repo);
const repoHits = [];
for (const f of yamls) {
  let kinds;
  try { kinds = manifestKinds(readFileSync(f, "utf8")); } catch { continue; }
  for (const k of kinds) {
    const r = removed.find((e) => e.version === k.apiVersion && e.kind === k.kind);
    if (r) repoHits.push({ file: relative(repo, f), apiVersion: k.apiVersion, kind: k.kind, removedIn: r.removedIn, replacement: r.replacement });
  }
}

// ---------- add-ons ----------

const inv = inventory(snap.workloads);
for (const c of CRD_COMPONENTS) {
  const crd = snap.crds.find((x) => x.metadata.name === c.crd);
  const v = crd?.metadata.annotations?.[c.annotation];
  if (v) inv.components.push({ ...c, versions: [v.replace(/^v/, "")], workloads: [`CRD/${c.crd}`], owners: ["unknown"], images: [], mirrored: false });
}
const osv = await osvGo(inv.components.filter((c) => goModule(c, c.versions[0] ?? "0")).flatMap((c) => c.versions.map((v) => ({ name: goModule(c, v), version: v }))));

const components = await pool(inv.components, 6, async (c) => {
  const cur = [...c.versions].sort(compareVersions)[0] ?? null;
  const base = { name: c.name, current: cur, versions: c.versions, owners: c.owners, workloads: c.workloads, repo: c.repo ?? null };
  if (c.core) return { ...base, core: true, severity: "none", reasons: ["upgrades with the control plane (skew checked on the nodes)"] };
  const bundled = c.mirrored && c.owners.includes("distro-addon");
  const vulns = cur ? [
    ...(osv.get(`${goModule(c, cur)}|${cur}`) ?? []),
    ...cves.filter((x) => c.feed && cveAffects(x, c.feed, cur)).map((x) => ({ id: x.id, cve: [x.id], severity: x.severity, fixed: fixFor(x, c.feed, cur), summary: x.summary })),
  ] : [];
  const [rels, cycles] = await Promise.all([
    c.repo ? githubReleases(c.repo, c.prefix).catch((e) => ({ error: e.message })) : [],
    c.eol ? endOfLife(c.eol) : [],
  ]);
  if (rels.error) return { ...base, error: rels.error, vulns, ...severityOf({ cves: vulns }) };
  const cooledRels = rels.filter((r) => !r.time || now - Date.parse(r.time) >= cooldown * DAY);
  let target = cur ? cooledRels.filter((r) => compareVersions(r.version, cur) > 0).at(-1)?.version ?? null : null;
  // cluster-autoscaler and similar track the Kubernetes minor: target the release for the target minor.
  if (c.k8sMinor) target = rels.filter((r) => minorOf(r.version) === targetMinor).at(-1)?.version ?? null;
  const required = vulns.map((v) => v.fixed).filter(Boolean).sort(compareVersions).at(-1) ?? null;
  let fresh = false;
  if (required && (!target || compareVersions(target, required) < 0)) { target = rels.find((r) => compareVersions(r.version, required) >= 0)?.version ?? required; fresh = true; }
  const latest = rels.at(-1)?.version ?? null;
  const t = (v) => rels.find((r) => compareVersions(r.version, v) === 0)?.time;
  const lagDays = cur && latest && t(cur) && t(latest) ? Math.round((Date.parse(t(latest)) - Date.parse(t(cur))) / DAY) : 0;
  const majorsBehind = cur && latest ? (parseVersion(latest).nums[0] - parseVersion(cur).nums[0]) : 0;
  const ceol = cur ? eolStatus(cycles, cur, now) : null;
  // An add-on past its end of life is high, not critical: the cluster keeps running, fixes stop.
  const sev = severityOf({ eol: ceol, eolPast: "high", cves: vulns, majorsBehind, lagDays, releasesBehind: cur ? rels.filter((r) => compareVersions(r.version, cur) > 0).length : 0 });
  const pkg = {
    ...base, ...sev, bundled, latest, target: bundled ? null : target, fresh, vulns, eol: ceol, lagDays,
    bump: target && cur ? bumpKind(cur, target) : "none",
    ...(c.versions.length > 1 ? { mixed: true } : {}),
    ...(bundled ? { reasons: [...sev.reasons, `bundled with ${distro}: upgrades with the distro`] } : {}),
  };
  if (target && cur && !bundled) {
    const entries = rels.filter((r) => compareVersions(r.version, cur) > 0 && compareVersions(r.version, target) <= 0 && r.body);
    if (entries.length) pkg.notes = note(`${c.name}.md`, `# ${c.name} ${cur} -> ${target} (github releases ${c.repo})\n\n${entries.map((e) => `## ${e.version}\n\n${e.body}`).join("\n\n").slice(0, 60_000)}\n`);
  }
  return pkg;
});

// ---------- HA and issues ----------

const ha = haChecks(snap, distro, cfg.exceptions ?? config.exceptions ?? []);
const issues = [
  ...(clusterSev.severity === "critical" || clusterSev.severity === "high" ? [{ level: clusterSev.severity, check: "cluster-version", target: "", what: `${current}: ${clusterSev.reasons.join("; ")}` }] : []),
  ...skewNow.map((s) => ({ level: s.level, check: "version-skew", target: s.what.split(":")[0], what: s.what })),
  ...[...new Map([...metricHits.map((m) => [`${m.group}/${m.version}/${m.resource}`, { level: "high", check: "removed-api", target: `${m.group || "core"}/${m.version} ${m.resource}`, what: `still requested, removed in ${m.removedRelease}` }]),
    ...repoHits.map((h) => [`${h.file}:${h.kind}`, { level: "high", check: "removed-api", target: `${h.file} ${h.apiVersion} ${h.kind}`, what: `removed in ${h.removedIn}, use ${h.replacement}` }])]).values()],
  ...ha.filter((f) => f.level === "critical" || f.level === "high"),
  ...components.filter((c) => !c.bundled && (c.severity === "critical" || (c.eol?.daysLeft != null && c.eol.daysLeft < 0))).map((c) => ({ level: c.severity, check: "component", target: c.name, what: `${c.current}: ${c.reasons.join("; ")}` })),
// Titles carry no versions, so next week's run finds the same issue instead of opening a new one.
].map((i) => ({ ...i, title: `[k8s-upgrades] ${name}: ${i.check}${i.target ? ` ${i.target}` : ""}` }));

const report = {
  cluster: name, context, distro, date: new Date(now).toISOString().slice(0, 10), cooldownDays: cooldown,
  severity: maxSeverity([clusterSev.severity, ...components.map((c) => c.severity)]),
  controlPlane: {
    current, apiservers, ...clusterSev, eol, path, stepChecks, cves: clusterCves, skew: skewNow, notes,
    controlPlaneNodes: nodes.filter((n) => n.controlPlane).length, upstream: k8sCycles ? eolStatus(k8sCycles, current, now) : null,
  },
  nodes, removedApis: { target: targetMinor, entries: removed.length, metrics: metricHits, metricsAvailable: !!snap.metrics, repo: repoHits },
  components, unmapped: inv.unmapped, ha, issues,
  gitops: { argoApps: snap.argoApps.length, fluxHelmReleases: snap.fluxHelmReleases.length, sucPlans: snap.sucPlans.map((p) => ({ name: `${p.metadata.namespace}/${p.metadata.name}`, version: p.spec.version ?? null, channel: p.spec.channel ?? null })) },
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));

// ---------- compact stdout ----------

const ORDER = ["critical", "high", "medium", "low", "none"];
const L = [];
const cps = nodes.filter((n) => n.controlPlane);
L.push(`k8s-upgrades ${report.date} cluster=${name} context=${context ?? "-"} distro=${distro} severity=${report.severity} cooldown=${cooldown}d report=${join(out, "report.json")}`);
L.push(`[${clusterSev.severity}] control plane ${current}${apiservers.length > 1 ? ` (${apiservers.length} apiservers: ${[...new Set(apiservers)].join(", ")})` : ""} | ${cps.length} control-plane, ${nodes.length - cps.length} workers | wait ${WAIT[clusterSev.severity]} | ${clusterSev.reasons.join("; ") || "current"}`);
L.push(`  eol ${eol ? `${eol.cycle} ${eol.eol}${eol.daysLeft != null ? ` (${eol.daysLeft}d)` : ""}` : "unknown"}${report.controlPlane.upstream ? ` | upstream ${report.controlPlane.upstream.cycle} eol ${report.controlPlane.upstream.eol}` : ""}`);
L.push(`  path: ${[path.patch && `patch ${path.patch}`, ...path.steps.map((s) => `-> ${s}`)].filter(Boolean).join(" ") || "none"}${path.latest ? ` (latest ${path.latest})` : ""}${MANAGED.has(distro) ? " — confirm with the provider CLI" : ""}`);
for (const s of stepChecks.filter((x) => x.blockers.length)) L.push(`  blocked before ${s.to}: ${s.blockers.join("; ")}`);
for (const s of skewNow) L.push(`  skew [${s.level}] ${s.what}`);
for (const c of clusterCves.slice(0, 8)) L.push(`  cve ${c.id} ${c.severity} ${c.components.join(",")} fix ${c.fixed ?? "none"}: ${c.summary.slice(0, 100)}`);
if (clusterCves.length > 8) L.push(`  +${clusterCves.length - 8} more CVEs in report.json`);
const versionsByKind = (sel) => [...new Set(nodes.map(sel))].join(", ");
L.push(`  nodes: kubelet ${versionsByKind((n) => n.kubelet)} | runtime ${versionsByKind((n) => n.runtime)} | os ${versionsByKind((n) => n.os)}`);
for (const [k, v] of Object.entries(notes)) L.push(`  notes ${k} ${v}`);
L.push(`removed APIs up to ${targetMinor}: ${metricHits.length} requested (metrics ${snap.metrics ? "from one apiserver" : "unavailable"}), ${repoHits.length} in repo manifests`);
for (const m of metricHits) L.push(`  live ${m.group || "core"}/${m.version} ${m.resource} removed in ${m.removedRelease}`);
for (const h of repoHits.slice(0, 15)) L.push(`  repo ${h.file}: ${h.apiVersion} ${h.kind} removed in ${h.removedIn} -> ${h.replacement}`);
L.push("components:");
for (const c of components.filter((x) => x.severity !== "none" || x.error).sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.name.localeCompare(b.name))) {
  if (c.error) { L.push(`[${c.severity}] ${c.name} ${c.current}: ERROR ${c.error}`); continue; }
  const to = c.bundled ? "-> with distro" : c.target ? `-> ${c.target}${c.fresh ? " (fresh, inside cooldown)" : ""}` : "-> hold (no cooled release)";
  L.push(`[${c.severity}] ${c.name} ${c.current}${c.mixed ? ` (mixed: ${c.versions.join(", ")})` : ""} ${to} latest ${c.latest} | ${c.bump} | owner ${c.owners.join(",")} | wait ${c.wait} | ${c.reasons.join("; ")}`);
  for (const v of c.vulns.slice(0, 3)) L.push(`  vuln ${v.id}${v.cve?.length && v.cve[0] !== v.id ? ` ${v.cve.join(",")}` : ""} ${v.severity} fix ${v.fixed ?? "none"}: ${v.summary}`);
  if (c.notes) L.push(`  notes ${c.notes}`);
}
const currentCount = components.filter((c) => c.severity === "none" && !c.error).length;
if (currentCount) L.push(`${currentCount} components current: ${components.filter((c) => c.severity === "none" && !c.error).map((c) => `${c.name} ${c.current ?? ""}`.trim()).join(", ")}`);
if (inv.unmapped.length) L.push(`unmapped system images (no release check): ${inv.unmapped.map((u) => `${u.image}:${u.tag}`).join(", ")}`);
// Per-workload findings that are common (single replica, no PDB) print as counts per namespace.
const GROUPED = new Set(["single-replica", "no-pdb"]);
L.push(`HA (${ha.length} findings):`);
for (const f of ha.filter((x) => !GROUPED.has(x.check)).sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level))) L.push(`  [${f.level}] ${f.check} ${f.target}: ${f.what}`);
for (const check of GROUPED) {
  const fs = ha.filter((x) => x.check === check);
  if (!fs.length) continue;
  const byNs = new Map();
  for (const f of fs) { const ns = f.target.split("/")[1]; byNs.set(ns, (byNs.get(ns) ?? 0) + 1); }
  L.push(`  [${fs[0].level}] ${check}: ${fs.length} workloads (${[...byNs].map(([ns, n]) => `${ns} ${n}`).join(", ")})`);
}
L.push(`gitops: ${report.gitops.argoApps} Argo CD apps, ${report.gitops.fluxHelmReleases} Flux HelmReleases, ${report.gitops.sucPlans.length} upgrade Plans${report.gitops.sucPlans.map((p) => ` ${p.name}@${p.version ?? p.channel}`).join("")}`);
L.push(`issues proposed (${issues.length}):`);
for (const i of issues) L.push(`  [${i.level}] ${i.title}`);
console.log(L.join("\n"));

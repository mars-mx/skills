// Shared helpers: versions, HTTP, OSV, changelogs, target and severity rules.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DAY = 86_400_000;

// ---------- versions (semver and PEP 440, close enough to order releases) ----------

export function parseVersion(v) {
  const m = String(v ?? "").trim().replace(/^[v=]+/i, "").match(/^(\d+(?:\.\d+)*)(.*)$/);
  return m ? { nums: m[1].split(".").map(Number), pre: m[2].replace(/\+.*$/, "") } : null;
}

function preRank(pre) {
  const p = pre.toLowerCase().replace(/^[-._]/, "");
  if (!p) return [3, ""];
  if (/^(post|rev|r\d)/.test(p)) return [4, p];
  if (/^dev/.test(p)) return [0, p];
  return [1, p];
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  const [ra, sa] = preRank(x.pre), [rb, sb] = preRank(y.pre);
  if (ra !== rb) return Math.sign(ra - rb);
  return Math.sign(sa.localeCompare(sb, undefined, { numeric: true }));
}

export function isStable(v) {
  const p = parseVersion(v);
  return !!p && preRank(p.pre)[0] >= 3;
}

// "major" also covers 0.x minor bumps, which semver treats as breaking.
export function bumpKind(from, to) {
  const a = parseVersion(from)?.nums, b = parseVersion(to)?.nums;
  if (!a || !b) return "unknown";
  if ((a[0] ?? 0) !== (b[0] ?? 0)) return "major";
  if ((a[0] ?? 0) === 0 && (a[1] ?? 0) !== (b[1] ?? 0)) return "major";
  if ((a[1] ?? 0) !== (b[1] ?? 0)) return "minor";
  return compareVersions(from, to) === 0 ? "none" : "patch";
}

function majorKey(v) {
  const n = parseVersion(v)?.nums ?? [];
  return n[0] === 0 ? `0.${n[1] ?? 0}` : String(n[0]);
}

// ---------- HTTP ----------

export async function getJSON(url, { headers = {}, method = "GET", body } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (res.status >= 500 && attempt < 2) continue;
      if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 2 || err.message?.includes("HTTP 4")) throw err;
    }
  }
}

export async function getText(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return res?.ok ? res.text() : null;
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---------- OSV ----------

const OSV = "https://api.osv.dev/v1";

// queries: [{ecosystem, name, version}] -> Map("eco|name|version" -> [vuln detail])
export async function osvScan(queries) {
  const uniq = [...new Map(queries.map((q) => [`${q.ecosystem}|${q.name}|${q.version}`, q])).values()];
  const idsByKey = new Map();
  for (let i = 0; i < uniq.length; i += 1000) {
    const chunk = uniq.slice(i, i + 1000);
    const res = await getJSON(`${OSV}/querybatch`, {
      method: "POST",
      body: { queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: q.ecosystem }, version: q.version })) },
    });
    await Promise.all(res.results.map(async (r, j) => {
      const q = chunk[j];
      const ids = (r.vulns ?? []).map((v) => v.id);
      let token = r.next_page_token;
      while (token) {
        const page = await getJSON(`${OSV}/query`, {
          method: "POST",
          body: { package: { name: q.name, ecosystem: q.ecosystem }, version: q.version, page_token: token },
        });
        ids.push(...(page?.vulns ?? []).map((v) => v.id));
        token = page?.next_page_token;
      }
      if (ids.length) idsByKey.set(`${q.ecosystem}|${q.name}|${q.version}`, ids);
    }));
  }
  const allIds = [...new Set([...idsByKey.values()].flat())];
  const details = new Map();
  await pool(allIds, 12, async (id) => details.set(id, await getJSON(`${OSV}/vulns/${id}`)));
  // Records without a severity (GO-, PYSEC-) take it from their GHSA alias.
  const withAliases = (ids) => [...new Set(ids.flatMap((id) => [id, ...(details.get(id)?.database_specific?.severity ? [] : (details.get(id)?.aliases ?? []).filter((a) => a.startsWith("GHSA-")))]))];
  const missing = [...new Set([...idsByKey.values()].flatMap(withAliases))].filter((id) => !details.has(id));
  await pool(missing, 12, async (id) => details.set(id, await getJSON(`${OSV}/vulns/${id}`).catch(() => null)));
  const out = new Map();
  for (const [key, ids] of idsByKey) {
    const [ecosystem, name, version] = key.split("|");
    // An alias record counts only if it names this package: a CVE can be shared by unrelated packages.
    const affects = (rec) => (rec.affected ?? []).some((a) => a.package?.ecosystem === ecosystem && normalizeName(a.package?.name, ecosystem) === name);
    const all = withAliases(ids).map((id) => details.get(id)).filter(Boolean);
    const own = all.filter((rec) => ids.includes(rec.id) || affects(rec));
    out.set(key, summarizeVulns(own, { ecosystem, name, version }, all.filter((rec) => !own.includes(rec))));
  }
  return out;
}

const SEVERITY_ORDER = ["none", "low", "medium", "high", "critical"];
const OSV_SEVERITY = { LOW: "low", MODERATE: "medium", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };

// Collapses aliases (GHSA and PYSEC for the same CVE) into one entry and takes
// severity and CWEs from whichever record carries them. `foreign` are alias records
// filed for another package (a Go stdlib CVE filed against an app that vendors it):
// they only fill in a missing severity and CWEs.
export function summarizeVulns(records, pkg, foreign = []) {
  const groups = [];
  for (const rec of records) {
    const keys = new Set([rec.id, ...(rec.aliases ?? [])]);
    const group = groups.find((g) => [...keys].some((k) => g.keys.has(k)));
    if (group) { keys.forEach((k) => group.keys.add(k)); group.records.push(rec); }
    else groups.push({ keys, records: [rec] });
  }
  const entries = groups.map(({ keys, records: recs }) => {
    recs.sort((a, b) => rank(b) - rank(a));
    const main = recs[0];
    const malicious = recs.some((r) => r.id.startsWith("MAL-"));
    const borrowed = foreign.filter((r) => keys.has(r.id) || (r.aliases ?? []).some((a) => keys.has(a)));
    const sev = [...recs, ...borrowed].map((r) => OSV_SEVERITY[r.database_specific?.severity]).find(Boolean);
    return {
      id: main.id,
      cve: [...keys].filter((k) => k.startsWith("CVE-")).sort(),
      severity: malicious ? "critical" : (sev ?? "unknown"),
      malicious,
      cwe: [...new Set([...recs, ...borrowed].flatMap((r) => r.database_specific?.cwe_ids ?? []))].sort(),
      cvss: recs.flatMap((r) => r.severity ?? []).find((s) => s.type?.startsWith("CVSS"))?.score ?? null,
      fixed: minFixed(recs, pkg),
      // Malware entries list hijacked versions; none listed and no fix means the whole package.
      ...(malicious ? { versions: affectedVersions(recs, pkg) } : {}),
      summary: (main.summary ?? main.details ?? "").split("\n")[0].trim().slice(0, 140),
    };
  });
  return entries.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) || a.id.localeCompare(b.id));
  function rank(r) {
    return (r.id.startsWith("MAL-") ? 4 : 0) + (r.id.startsWith("GHSA-") ? 2 : 0) + (r.database_specific?.severity ? 1 : 0);
  }
}

function affectedVersions(records, pkg) {
  return [...new Set(records.flatMap((r) => (r.affected ?? [])
    .filter((a) => normalizeName(a.package?.name, pkg.ecosystem) === pkg.name)
    .flatMap((a) => a.versions ?? [])))];
}

// Smallest "fixed" event above the current version for this package.
function minFixed(records, pkg) {
  const fixes = records.flatMap((r) => (r.affected ?? [])
    .filter((a) => a.package?.ecosystem === pkg.ecosystem && normalizeName(a.package?.name, pkg.ecosystem) === pkg.name)
    .flatMap((a) => (a.ranges ?? []).filter((x) => x.type !== "GIT").flatMap((x) => x.events.map((e) => e.fixed).filter(Boolean))))
    .filter((f) => compareVersions(f, pkg.version) > 0)
    .sort(compareVersions);
  return fixes[0] ?? null;
}

export function normalizeName(name, ecosystem) {
  return ecosystem === "PyPI" ? String(name).toLowerCase().replace(/[-_.]+/g, "-") : name;
}

// ---------- targets and severity ----------

// versions: [{version, time: ISO string, deprecated?: bool, yanked?: bool}]
export function chooseTarget({ current, versions, vulns, cooldownDays, now = Date.now() }) {
  const hijacked = new Set(vulns.filter((v) => v.malicious).flatMap((v) => v.versions ?? []));
  const remove = vulns.some((v) => v.malicious && !v.fixed && !v.versions?.length);
  const usable = versions.filter((v) => isStable(v.version) && !v.deprecated && !v.yanked && !hijacked.has(v.version))
    .sort((a, b) => compareVersions(a.version, b.version));
  const latest = usable.at(-1)?.version ?? null;
  const cooled = usable.filter((v) => !v.time || now - Date.parse(v.time) >= cooldownDays * DAY);
  const newer = (v) => compareVersions(v.version, current) > 0;
  let target = cooled.filter(newer).at(-1)?.version ?? null;
  let inMajor = cooled.filter((v) => newer(v) && majorKey(v.version) === majorKey(current)).at(-1)?.version ?? null;

  // A security fix beats the cooldown: the target is at least the highest required fix.
  const required = vulns.map((v) => v.fixed).filter(Boolean).sort(compareVersions).at(-1) ?? null;
  let fresh = false;
  if (required) {
    const atLeast = (v) => compareVersions(v.version, required) >= 0;
    if (!target || compareVersions(target, required) < 0) {
      target = usable.find(atLeast)?.version ?? required;
      fresh = !cooled.some((v) => v.version === target);
    }
    if (inMajor && compareVersions(inMajor, required) < 0) {
      inMajor = usable.find((v) => atLeast(v) && majorKey(v.version) === majorKey(current))?.version ?? null;
    }
  }
  const time = (ver) => versions.find((v) => compareVersions(v.version, ver) === 0)?.time;
  const released = usable.filter((v) => newer(v)).length;
  const lagDays = time(current) && time(latest) && compareVersions(latest, current) > 0
    ? Math.round((Date.parse(time(latest)) - Date.parse(time(current))) / DAY) : 0;
  const majorsBehind = new Set(usable.filter(newer).map((v) => majorKey(v.version)).filter((k) => k !== majorKey(current))).size;
  if (remove) return { latest, target: null, inMajor: null, required: null, fresh: false, remove, releasesBehind: released, lagDays, majorsBehind };
  return { latest, target, inMajor, required, fresh, remove, releasesBehind: released, lagDays, majorsBehind };
}

export const WAIT = { critical: "now (24h)", high: "7 days", medium: "30 days", low: "next cycle (90 days)", none: "-" };

export function severityOf({ vulns, deprecated, yanked, majorsBehind, lagDays, releasesBehind }) {
  const fromVulns = vulns.map((v) => (v.severity === "unknown" ? "medium" : v.severity));
  const reasons = [];
  let level = "none";
  const raise = (l, why) => {
    reasons.push(why);
    if (SEVERITY_ORDER.indexOf(l) > SEVERITY_ORDER.indexOf(level)) level = l;
  };
  if (vulns.some((v) => v.malicious)) raise("critical", "malicious package");
  if (vulns.length) raise(maxSeverity(fromVulns), `${vulns.length} vuln${vulns.length > 1 ? "s" : ""}`);
  if (deprecated) raise("high", "current version deprecated");
  if (yanked) raise("high", "current version yanked");
  if (majorsBehind >= 3) raise("high", `${majorsBehind} majors behind`);
  else if (majorsBehind >= 1) raise("medium", `${majorsBehind} major${majorsBehind > 1 ? "s" : ""} behind`);
  if (lagDays >= 730) raise("high", `${Math.round(lagDays / 365)}y behind latest`);
  else if (lagDays >= 365) raise("medium", "1y+ behind latest");
  if (level === "none" && releasesBehind > 0) raise("low", "outdated");
  return { severity: level, wait: WAIT[level], reasons: [...new Set(reasons)] };
}

export function maxSeverity(levels) {
  return levels.reduce((m, l) => (SEVERITY_ORDER.indexOf(l) > SEVERITY_ORDER.indexOf(m) ? l : m), "none");
}

// ---------- changelogs ----------

const BREAKING = /breaking|no longer|removed?\b|drop(ped|s)? support|deprecat|renamed|migrat|incompatib/i;
const SECURITY = /security|CVE-\d{4}-\d+|vulnerab|\bXSS\b|injection|prototype pollution|ReDoS|SSRF|\bRCE\b|sanitiz/i;

let ghToken;
function githubHeaders() {
  if (ghToken === undefined) {
    ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (!ghToken) {
      try { ghToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
      catch { ghToken = ""; }
    }
  }
  return { "user-agent": "dep-upgrades", ...(ghToken ? { authorization: `Bearer ${ghToken}` } : {}) };
}

export function githubRepo(url) {
  const m = String(url ?? "").match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Version from a release tag: "v1.2.3", "1.2.3", "pkg@1.2.3", "@scope/pkg@1.2.3". Null for another package's tag.
export function tagVersion(tag, name) {
  const at = tag.lastIndexOf("@");
  if (at > 0) {
    const owner = tag.slice(0, at);
    if (owner !== name && owner !== name.split("/").pop()) return null;
    tag = tag.slice(at + 1);
  }
  const m = tag.match(/(\d+\.\d+(?:\.\d+)*(?:[-.]?[a-z]+[.-]?\d*)?)$/i);
  return m ? m[1] : null;
}

// Changelog sections from a CHANGELOG file, keyed by the first version in each heading.
export function changelogSections(text) {
  const sections = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^(?:#{1,4}\s+|\[)?\[?v?(\d+\.\d+(?:\.\d+)*(?:[-.]?[a-z]+[.-]?\d*)?)\]?(?:\s|$|\]|\(| -|:)/i);
    if (heading && (line.startsWith("#") || line.startsWith("[") || /^\d/.test(line) || line.startsWith("v"))) {
      cur = { version: heading[1], body: [] };
      sections.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return sections.map((s) => ({ version: s.version, body: s.body.join("\n").trim() }));
}

const CHANGELOG_FILES = ["CHANGELOG.md", "CHANGES.md", "HISTORY.md", "CHANGELOG.rst", "CHANGES.rst", "HISTORY.rst", "docs/changelog.md", "NEWS.md"];

// Release notes for versions in (from, to]. Returns {source, entries: [{version, body}]}.
export async function releaseNotes({ repo, name, from, to }) {
  if (!repo || !to) return { source: null, entries: [] };
  const inRange = (v) => v && isStable(v) && compareVersions(v, from) > 0 && compareVersions(v, to) <= 0;
  let error = null;
  const releases = await getJSON(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers: githubHeaders() })
    .catch((err) => { error = err.message.replace(/^GET \S+: /, "github "); return null; });
  const entries = (releases ?? [])
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({ version: tagVersion(r.tag_name, name), body: (r.body ?? "").trim() }))
    .filter((e) => inRange(e.version) && e.body);
  if (entries.length) return { source: `github releases ${repo}`, entries: entries.sort((a, b) => compareVersions(a.version, b.version)) };
  for (const file of CHANGELOG_FILES) {
    const text = await getText(`https://raw.githubusercontent.com/${repo}/HEAD/${file}`);
    if (!text) continue;
    const found = changelogSections(text).filter((s) => inRange(s.version) && s.body);
    if (found.length) return { source: `${repo}/${file}`, entries: found.sort((a, b) => compareVersions(a.version, b.version)) };
  }
  return { source: null, entries: [], error };
}

export function flagLines(entries) {
  const lines = entries.flatMap((e) => e.body.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ version: e.version, line: l })));
  const pick = (re) => lines.filter((l) => re.test(l.line)).map((l) => `${l.version}: ${l.line.replace(/\s+/g, " ").slice(0, 160)}`);
  return { breaking: pick(BREAKING), security: pick(SECURITY) };
}

// ---------- discovery ----------

const SKIP_DIRS = new Set(["node_modules", "vendor", ".git", ".venv", "venv", "env", "site-packages", "dist", "build", ".next", ".tox", "__pycache__", "coverage"]);

export function findFiles(root, match, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) findFiles(root, match, join(dir, entry.name), out);
    } else if (match(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

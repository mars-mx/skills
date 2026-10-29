// Shared helpers: versions, HTTP, release data, CVE feed, removed APIs, skew and severity rules.
// Self-contained on purpose: this plugin installs without deps-skills.
import { execFileSync } from "node:child_process";

export const DAY = 86_400_000;

// ---------- versions ----------

// "v1.33.13+k3s2", "1.33", "distroless-v1.38.1", "controller-v1.12.1" -> {nums, pre, build}
export function parseVersion(v) {
  const m = String(v ?? "").trim().match(/v?(\d+(?:\.\d+)*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/);
  return m ? { nums: m[1].split(".").map(Number), pre: m[2] ?? "", build: m[3] ?? "" } : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre !== y.pre) return !x.pre ? 1 : !y.pre ? -1 : Math.sign(x.pre.localeCompare(y.pre, undefined, { numeric: true }));
  // Distro builds of one upstream version: v1.33.13+k3s2 > v1.33.13+k3s1.
  return Math.sign(x.build.localeCompare(y.build, undefined, { numeric: true }));
}

export const isStable = (v) => { const p = parseVersion(v); return !!p && !p.pre; };

// "1.33" for any 1.33.x
export const minorOf = (v) => { const n = parseVersion(v)?.nums; return n ? `${n[0]}.${n[1] ?? 0}` : null; };
export const minorNum = (v) => parseVersion(v)?.nums[1] ?? null;
export const nextMinor = (m) => `${m.split(".")[0]}.${Number(m.split(".")[1]) + 1}`;

export function bumpKind(from, to) {
  const a = parseVersion(from)?.nums, b = parseVersion(to)?.nums;
  if (!a || !b) return "unknown";
  if ((a[0] ?? 0) !== (b[0] ?? 0) || ((a[0] ?? 0) === 0 && (a[1] ?? 0) !== (b[1] ?? 0))) return "major";
  if ((a[1] ?? 0) !== (b[1] ?? 0)) return "minor";
  return compareVersions(from, to) === 0 ? "none" : "patch";
}

// ---------- HTTP ----------

export async function getJSON(url, { headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (res.status >= 500 && attempt < 2) continue;
      if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
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

let ghToken;
export function githubHeaders() {
  if (ghToken === undefined) {
    ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (!ghToken) {
      try { ghToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
      catch { ghToken = ""; }
    }
  }
  return { "user-agent": "k8s-upgrades", ...(ghToken ? { authorization: `Bearer ${ghToken}` } : {}) };
}

// ---------- releases ----------

// Version from a release tag: "v1.2.3", "controller-v1.12.1", "cluster-autoscaler-1.30.0".
// With a prefix, tags of other components in a monorepo map to null.
export function tagVersion(tag, prefix = "") {
  if (prefix && !tag.startsWith(prefix)) return null;
  const m = tag.slice(prefix.length).match(/v?(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?)$/);
  return m ? m[1] : null;
}

// GitHub releases as [{version, time, body}], newest 100.
export async function githubReleases(repo, prefix = "") {
  const list = await getJSON(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers: githubHeaders() });
  return (list ?? [])
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({ version: tagVersion(r.tag_name, prefix), time: r.published_at, body: (r.body ?? "").trim(), tag: r.tag_name }))
    .filter((r) => r.version && isStable(r.version))
    .sort((a, b) => compareVersions(a.version, b.version));
}

// endoflife.date cycles: [{cycle, releaseDate, eol, support, latest, extendedSupport?}]
export async function endOfLife(product) {
  return (await getJSON(`https://endoflife.date/api/${product}.json`).catch(() => null)) ?? [];
}

// EOL state of one version against endoflife.date cycles. Cycles are "1.33" or "3" (major only).
export function eolStatus(cycles, version, now = Date.now()) {
  const n = parseVersion(version)?.nums;
  if (!n) return null;
  const c = cycles.find((x) => x.cycle === `${n[0]}.${n[1]}`) ?? cycles.find((x) => x.cycle === String(n[0]));
  if (!c) return null;
  const eol = typeof c.eol === "string" ? Date.parse(c.eol) : c.eol === true ? now - DAY : null;
  return { cycle: c.cycle, eol: typeof c.eol === "string" ? c.eol : c.eol, extended: c.extendedSupport ?? null, daysLeft: eol ? Math.floor((eol - now) / DAY) : null };
}

const cooled = (r, days, now) => !r.time || now - Date.parse(r.time) >= days * DAY;

// Cluster upgrade path. releases: [{version, time}] of the distro (upstream, k3s, rke2, ...).
// The patch target is the newest cooled release in the current minor. Each later minor
// qualifies once it has a cooled patch .1 or later (a .0 alone never does); the path
// steps one minor at a time, as the version skew policy requires.
export function upgradePath({ current, releases, cooldownDays, now = Date.now(), maxMinor = null }) {
  const curMinor = minorOf(current);
  const ok = releases.filter((r) => cooled(r, cooldownDays, now));
  const newestIn = (m, list = ok) => list.filter((r) => minorOf(r.version) === m).at(-1)?.version ?? null;
  const patch = newestIn(curMinor);
  const steps = [];
  for (let m = nextMinor(curMinor); ; m = nextMinor(m)) {
    if (maxMinor && minorNum(`${m}.0`) > minorNum(`${maxMinor}.0`)) break;
    const v = newestIn(m);
    if (!v || (parseVersion(v).nums[2] ?? 0) < 1) break;
    steps.push(v);
  }
  const latest = releases.at(-1)?.version ?? null;
  return {
    current, patch: patch && compareVersions(patch, current) > 0 ? patch : null, steps,
    target: steps.at(-1) ?? patch ?? null, latest,
    minorsBehind: latest ? minorNum(latest) - minorNum(current) : 0,
    patchesBehind: releases.filter((r) => minorOf(r.version) === curMinor && compareVersions(r.version, current) > 0).length,
  };
}

// ---------- official Kubernetes CVE feed ----------

export const CORE = ["kube-apiserver", "kubelet", "kube-controller-manager", "kube-scheduler", "kube-proxy", "kubernetes", "kubectl"];
const SEVERITY_ORDER = ["none", "low", "medium", "high", "critical"];

// One feed item -> {id, url, severity, published, summary, ranges: [{component, fixed?, upTo?, from?}]}
export function parseCve(item) {
  const text = item.content_text ?? "";
  const sev = text.match(/\b(Low|Medium|High|Critical)\s*\(\d/i)?.[1]?.toLowerCase()
    ?? text.match(/CVSS:3\.\d[^)]*?\)\s*-?\s*\**(Low|Medium|High|Critical)/i)?.[1]?.toLowerCase() ?? "unknown";
  const ranges = [];
  const V = "v?(\\d+\\.\\d+\\.\\d+)";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s*-]+/, "").replace(/`/g, "").trim();
    let m;
    if ((m = line.match(new RegExp(`^(.+?):?\\s*>=\\s*${V}`)))) ranges.push({ component: norm(m[1]), fixed: m[2] });
    else if ((m = line.match(new RegExp(`^(.+?):?\\s*<=\\s*${V}`)))) ranges.push({ component: norm(m[1]), upTo: m[2] });
    else if ((m = line.match(new RegExp(`^(.+?):?\\s*<\\s*${V}`)))) ranges.push({ component: norm(m[1]), fixed: m[2] });
    else if ((m = line.match(new RegExp(`^(.+?):?\\s+${V}\\s*(?:to|-)\\s*${V}`)))) ranges.push({ component: norm(m[1]), from: m[2], upTo: m[3] });
  }
  return { id: item.id, url: item.url, severity: sev, published: item.date_published, summary: item.summary ?? "", ranges };
  function norm(s) { return s.replace(/versions?$/i, "").replace(/:$/, "").trim().toLowerCase(); }
}

// Is `version` of `component` affected? A fix in the same minor decides; a minor older than
// every fixed minor counts as affected (no fix was backported to it).
export function cveAffects(cve, component, version) {
  const rs = cve.ranges.filter((r) => r.component === component || (CORE.includes(component) && r.component === "kubernetes"));
  if (!rs.length) return false;
  const m = minorOf(version);
  const sameMinor = rs.filter((r) => minorOf(r.fixed ?? r.upTo) === m);
  const fix = sameMinor.find((r) => r.fixed);
  if (fix) return compareVersions(version, fix.fixed) < 0;
  const upTo = sameMinor.find((r) => r.upTo);
  if (upTo) return compareVersions(version, upTo.upTo) <= 0 && (!upTo.from || compareVersions(version, upTo.from) >= 0);
  const minors = rs.map((r) => minorNum(r.fixed ?? r.upTo));
  return minorNum(version) < Math.min(...minors);
}

export function fixFor(cve, component, version) {
  const rs = cve.ranges.filter((r) => r.fixed && (r.component === component || (CORE.includes(component) && r.component === "kubernetes")));
  return rs.find((r) => minorOf(r.fixed) === minorOf(version))?.fixed
    ?? rs.filter((r) => compareVersions(r.fixed, version) > 0).sort((a, b) => compareVersions(a.fixed, b.fixed))[0]?.fixed ?? null;
}

// ---------- removed APIs (FairwindsOps/pluto versions.yaml) ----------

// Flat list of maps under "deprecated-versions:" -> [{version, kind, deprecatedIn, removedIn, replacement, component}]
export function parsePluto(text) {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(-\s+)?([\w-]+):\s*(.*)$/);
    if (!m || m[2] === "deprecated-versions" || m[2] === "target-versions") continue;
    if (m[1]) { cur = {}; out.push(cur); }
    if (cur) cur[m[2]] = m[3].replace(/^["']|["']$/g, "").trim();
  }
  return out.filter((e) => e.version && e.kind).map((e) => ({
    version: e.version, kind: e.kind, deprecatedIn: e["deprecated-in"] || null, removedIn: e["removed-in"] || null,
    replacement: e["replacement-api"] || null, component: e.component || "k8s",
  }));
}

// Entries removed at or before `target` (a minor like "1.35") that `current` still serves.
export function removedBy(entries, current, target) {
  return entries.filter((e) => e.component === "k8s" && e.removedIn
    && compareVersions(e.removedIn, `${current}.999`) > 0 && compareVersions(e.removedIn, `${target}.999`) <= 0);
}

// apiVersion/kind pairs of every document in a YAML stream (top-level keys only).
export function manifestKinds(text) {
  return text.split(/^---\s*$/m).map((doc) => ({
    apiVersion: doc.match(/^apiVersion:\s*["']?([^\s"'#]+)/m)?.[1],
    kind: doc.match(/^kind:\s*["']?([^\s"'#]+)/m)?.[1],
  })).filter((d) => d.apiVersion && d.kind);
}

// ---------- version skew policy (kubernetes.io/releases/version-skew-policy) ----------

// apiservers: versions of every kube-apiserver; nodes: [{name, kubelet, kubeProxy?}].
export function skewFindings({ apiservers, nodes, controllers = [] }) {
  const out = [];
  const minors = apiservers.map(minorNum);
  const oldest = Math.min(...minors), newest = Math.max(...minors);
  if (newest - oldest > 1) out.push({ level: "critical", what: `kube-apiserver instances span ${newest - oldest} minors (max 1)` });
  for (const n of nodes) {
    const k = minorNum(n.kubelet);
    if (k > oldest) out.push({ level: "critical", what: `${n.name}: kubelet ${n.kubelet} newer than the oldest kube-apiserver` });
    else if (oldest - k > 3) out.push({ level: "critical", what: `${n.name}: kubelet ${n.kubelet} more than 3 minors behind kube-apiserver` });
    else if (oldest - k >= 2) out.push({ level: "high", what: `${n.name}: kubelet ${n.kubelet} ${oldest - k} minors behind kube-apiserver: blocks the next control-plane minor` });
  }
  for (const c of controllers) {
    const k = minorNum(c.version);
    if (k > oldest || oldest - k > 1) out.push({ level: "critical", what: `${c.name} ${c.version} outside one minor below kube-apiserver` });
  }
  return out;
}

// Before the control plane moves to `target` minor (skew policy, "Supported component upgrade
// order"): every kubelet must already be within 2 minors of the target, and no apiserver may skip a minor.
export function readyForMinor({ apiservers, nodes, target }) {
  const [major, t] = target.split(".").map(Number);
  return [
    ...apiservers.filter((v) => t - minorNum(v) > 1).map((v) => `kube-apiserver ${v} would skip a minor`),
    ...nodes.filter((n) => t - minorNum(n.kubelet) > 2).map((n) => `${n.name}: kubelet ${n.kubelet} must reach ${major}.${t - 2} first`),
  ];
}

// ---------- severity ----------

export const WAIT = { critical: "now (24h)", high: "7 days", medium: "30 days", low: "next cycle (90 days)", none: "-" };

export function maxSeverity(levels) {
  return levels.reduce((m, l) => (SEVERITY_ORDER.indexOf(l) > SEVERITY_ORDER.indexOf(m) ? l : m), "none");
}

// eol: eolStatus(); cves: [{severity}]; minorsBehind, patchesBehind, majorsBehind, lagDays as available.
export function severityOf({ eol, eolPast = "critical", cves = [], minorsBehind = 0, majorsBehind = 0, patchesBehind = 0, lagDays = 0, releasesBehind = 0, skew = [] }) {
  const reasons = [];
  let level = "none";
  const raise = (l, why) => { reasons.push(why); if (SEVERITY_ORDER.indexOf(l) > SEVERITY_ORDER.indexOf(level)) level = l; };
  if (eol?.daysLeft != null) {
    if (eol.daysLeft < 0) raise(eol.extended && Date.parse(eol.extended) > Date.now() ? "high" : eolPast, `${eol.cycle} end of life since ${eol.eol}${eol.extended ? ` (extended support until ${eol.extended})` : ""}`);
    else if (eol.daysLeft <= 60) raise("high", `${eol.cycle} end of life in ${eol.daysLeft} days`);
    else if (eol.daysLeft <= 180) raise("medium", `${eol.cycle} end of life in ${eol.daysLeft} days`);
  }
  for (const s of skew) raise(s.level, s.what);
  if (cves.length) raise(maxSeverity(cves.map((c) => (c.severity === "unknown" ? "medium" : c.severity))), `${cves.length} CVE${cves.length > 1 ? "s" : ""}`);
  if (majorsBehind >= 2) raise("high", `${majorsBehind} majors behind`);
  else if (majorsBehind === 1) raise("medium", "1 major behind");
  if (minorsBehind >= 3) raise("high", `${minorsBehind} minors behind`);
  else if (minorsBehind >= 1) raise("medium", `${minorsBehind} minor${minorsBehind > 1 ? "s" : ""} behind`);
  if (lagDays >= 730) raise("high", `${Math.round(lagDays / 365)}y behind latest`);
  else if (lagDays >= 365) raise("medium", "1y+ behind latest");
  if (level === "none" && (patchesBehind > 0 || releasesBehind > 0)) raise("low", "outdated");
  return { severity: level, wait: WAIT[level], reasons: [...new Set(reasons)] };
}

// ---------- Kubernetes CHANGELOG ----------

// From CHANGELOG-<minor>.md: the sections of "# v<minor>.0" that matter before an upgrade.
export function changelogExtract(text, minor) {
  const start = text.search(new RegExp(`^# v${minor.replace(".", "\\.")}\\.0\\s*$`, "m"));
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const end = rest.search(/^# v/m);
  const body = end < 0 ? rest : rest.slice(0, end);
  const keep = [/^## Urgent Upgrade Notes/i, /^### Deprecation/i, /^### API Change/i];
  const out = [];
  let on = false;
  for (const line of body.split("\n")) {
    if (/^#{2,3} /.test(line)) on = keep.some((re) => re.test(line));
    if (on) out.push(line);
  }
  return out.join("\n").trim();
}

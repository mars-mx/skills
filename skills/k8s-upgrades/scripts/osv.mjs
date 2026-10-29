// OSV lookups for component Go modules: [{name, version}] -> Map("name|version" -> [vuln]).
import { compareVersions, getJSON, pool } from "./lib.mjs";

const OSV = "https://api.osv.dev/v1";
const SEV = { LOW: "low", MODERATE: "medium", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };

export async function osvGo(queries) {
  const out = new Map();
  if (!queries.length) return out;
  const res = await fetch(`${OSV}/querybatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: queries.map((q) => ({ package: { ecosystem: "Go", name: q.name }, version: q.version.startsWith("v") ? q.version : `v${q.version}` })) }),
    signal: AbortSignal.timeout(60_000),
  }).then((r) => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] }));
  const ids = new Set();
  res.results?.forEach((r, i) => { const v = (r.vulns ?? []).map((x) => x.id); if (v.length) { out.set(`${queries[i].name}|${queries[i].version}`, v); v.forEach((id) => ids.add(id)); } });
  const details = new Map();
  await pool([...ids], 12, async (id) => details.set(id, await getJSON(`${OSV}/vulns/${id}`).catch(() => null)));
  for (const [key, list] of out) {
    const [name, version] = key.split("|");
    const seen = new Set();
    out.set(key, list.map((id) => details.get(id)).filter(Boolean).filter((rec) => {
      const k = [rec.id, ...(rec.aliases ?? [])];
      if (k.some((x) => seen.has(x))) return false;
      k.forEach((x) => seen.add(x));
      return true;
    }).map((rec) => ({
      id: rec.id,
      cve: [rec.id, ...(rec.aliases ?? [])].filter((a) => a.startsWith("CVE-")),
      severity: SEV[rec.database_specific?.severity] ?? "unknown",
      fixed: (rec.affected ?? []).filter((a) => a.package?.name === name).flatMap((a) => (a.ranges ?? []).flatMap((r) => r.events.map((e) => e.fixed).filter(Boolean)))
        .filter((f) => compareVersions(f, version) > 0).sort(compareVersions)[0] ?? null,
      summary: (rec.summary ?? rec.details ?? "").split("\n")[0].slice(0, 140),
    })));
  }
  return out;
}

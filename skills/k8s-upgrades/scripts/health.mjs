#!/usr/bin/env node
// Usage: node health.mjs --context <ctx> [--node <name>] [--expect <version>] [--allow-cordoned <node,...>] [--wait <seconds>]
// Read-only gate between upgrade steps. Exits 0 when the cluster is healthy, 1 when not
// (after --wait seconds of retrying), 2 on usage errors.
//   --expect   every control-plane node (or --node) must run this kubelet version
//   --node     the node that was just upgraded: Ready, schedulable, on --expect
import { kube, isControlPlane } from "./cluster.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const context = flag("--context", null);
const node = flag("--node", null);
const expect = flag("--expect", null);
const allowCordoned = new Set((flag("--allow-cordoned", "") || "").split(",").filter(Boolean));
const wait = Number(flag("--wait", 0));
if (!context) { console.error("usage: health.mjs --context <ctx> [--node <name>] [--expect <version>] [--wait <s>]"); process.exit(2); }

const ready = (o) => o.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True");
const norm = (v) => String(v).replace(/^v/, "");

function check() {
  const fail = [], warn = [];
  const nodes = kube(context, ["get", "nodes"]).items;
  for (const n of nodes) {
    const name = n.metadata.name;
    if (!ready(n)) fail.push(`node ${name} not Ready`);
    if (n.spec.unschedulable && !allowCordoned.has(name)) (name === node ? fail : warn).push(`node ${name} cordoned`);
  }
  if (node) {
    const n = nodes.find((x) => x.metadata.name === node);
    if (!n) fail.push(`node ${node} not found`);
    else if (expect && norm(n.status.nodeInfo.kubeletVersion) !== norm(expect)) fail.push(`node ${node} runs ${n.status.nodeInfo.kubeletVersion}, expected ${expect}`);
  } else if (expect) {
    for (const n of nodes.filter(isControlPlane)) {
      if (norm(n.status.nodeInfo.kubeletVersion) !== norm(expect)) fail.push(`control plane ${n.metadata.name} runs ${n.status.nodeInfo.kubeletVersion}, expected ${expect}`);
    }
  }
  const readyz = kube(context, ["get", "--raw", "/readyz?verbose"], { json: false, allowFail: true });
  if (!readyz || !/readyz check passed/.test(readyz)) fail.push(`/readyz: ${readyz ? readyz.split("\n").filter((l) => /failed/.test(l)).join("; ") : "no answer"}`);

  const pods = kube(context, ["get", "pods", "-A"]).items.filter((p) => !["Succeeded"].includes(p.status?.phase));
  for (const p of pods) {
    const ref = `${p.metadata.namespace}/${p.metadata.name}`;
    const waiting = (p.status?.containerStatuses ?? []).map((c) => c.state?.waiting?.reason).filter(Boolean);
    const crash = waiting.find((r) => /CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError/.test(r));
    const system = p.metadata.namespace === "kube-system";
    if (crash) (system ? fail : warn).push(`pod ${ref} ${crash}`);
    else if (p.status?.phase === "Pending") (system ? fail : warn).push(`pod ${ref} Pending${p.status?.conditions?.find((c) => c.reason === "Unschedulable") ? " (unschedulable)" : ""}`);
    else if (system && p.status?.phase === "Running" && !ready(p)) fail.push(`pod ${ref} not Ready`);
  }
  for (const pdb of kube(context, ["get", "poddisruptionbudgets", "-A"]).items) {
    if ((pdb.status?.expectedPods ?? 0) > 0 && pdb.status.currentHealthy < pdb.status.desiredHealthy) warn.push(`PDB ${pdb.metadata.namespace}/${pdb.metadata.name} below desired (${pdb.status.currentHealthy}/${pdb.status.desiredHealthy})`);
  }
  return { fail, warn, nodes: nodes.length };
}

const deadline = Date.now() + wait * 1000;
let r;
for (;;) {
  r = check();
  if (!r.fail.length || Date.now() >= deadline) break;
  await new Promise((res) => setTimeout(res, 15_000));
}
console.log(`${r.fail.length ? "FAIL" : "OK"} context=${context} nodes=${r.nodes}${node ? ` node=${node}` : ""}${expect ? ` expect=${expect}` : ""}`);
for (const f of r.fail) console.log(`  fail ${f}`);
for (const w of r.warn.slice(0, 30)) console.log(`  warn ${w}`);
if (r.warn.length > 30) console.log(`  +${r.warn.length - 30} more warnings`);
process.exit(r.fail.length ? 1 : 0);

// Read-only cluster access: snapshot, distro detection, and HA checks.
// Every kubectl call goes through kube(), which allows only reads and always pins --context.
import { execFileSync } from "node:child_process";
import { parseVersion } from "./lib.mjs";

const READ_VERBS = new Set(["get", "version", "api-resources", "api-versions"]);

export function kube(context, args, { json = true, allowFail = false } = {}) {
  if (!READ_VERBS.has(args[0])) throw new Error(`kube(): refusing non-read verb "${args[0]}"`);
  if (args[0] === "get" && args[1] === "--raw" && !/^\/(readyz|livez|healthz|version|metrics)/.test(args[2] ?? "")) throw new Error(`kube(): raw path not allowed: ${args[2]}`);
  try {
    const out = execFileSync("kubectl", ["--context", context, ...args, ...(json && args[1] !== "--raw" ? ["-o", "json"] : [])], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
    return json && args[1] !== "--raw" ? JSON.parse(out) : out;
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`kubectl --context ${context} ${args.join(" ")}: ${(err.stderr || err.message).toString().trim().split("\n")[0]}`);
  }
}

const items = (r) => r?.items ?? [];

// Everything the scan needs, in one pass. Optional resources (CRDs) may be missing.
export function snapshot(context) {
  const get = (what, opts) => items(kube(context, ["get", what, "-A"], { allowFail: true, ...opts }));
  return {
    context,
    version: kube(context, ["version"]).serverVersion,
    nodes: items(kube(context, ["get", "nodes"])),
    workloads: [...get("deployments"), ...get("daemonsets"), ...get("statefulsets")],
    pods: get("pods"),
    pdbs: get("poddisruptionbudgets"),
    pvs: items(kube(context, ["get", "pv"], { allowFail: true })),
    pvcs: get("persistentvolumeclaims"),
    services: get("services"),
    crds: items(kube(context, ["get", "customresourcedefinitions"], { allowFail: true })),
    webhooks: [
      ...items(kube(context, ["get", "validatingwebhookconfigurations"], { allowFail: true })),
      ...items(kube(context, ["get", "mutatingwebhookconfigurations"], { allowFail: true })),
    ],
    apiservices: items(kube(context, ["get", "apiservices"], { allowFail: true })),
    kubeadmConfig: kube(context, ["get", "configmap", "kubeadm-config", "-n", "kube-system"], { allowFail: true }),
    argoApps: get("applications.argoproj.io"),
    fluxHelmReleases: get("helmreleases.helm.toolkit.fluxcd.io"),
    sucPlans: get("plans.upgrade.cattle.io"),
    // Only one apiserver answers each request: in HA these metrics cover the instance the LB picked.
    metrics: kube(context, ["get", "--raw", "/metrics"], { json: false, allowFail: true }),
    readyz: kube(context, ["get", "--raw", "/readyz?verbose"], { json: false, allowFail: true }),
  };
}

export const isControlPlane = (n) => {
  const l = n.metadata.labels ?? {};
  return "node-role.kubernetes.io/control-plane" in l || "node-role.kubernetes.io/master" in l;
};
const isReady = (n) => n.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True");

export function detectDistro(snap) {
  const n = snap.nodes;
  const provider = n.map((x) => x.spec?.providerID ?? "").find(Boolean) ?? "";
  const kubelet = n[0]?.status?.nodeInfo?.kubeletVersion ?? "";
  const os = n[0]?.status?.nodeInfo?.osImage ?? "";
  const git = snap.version?.gitVersion ?? "";
  if (/-eks-/.test(git) || n.some((x) => x.metadata.labels?.["eks.amazonaws.com/nodegroup"] || x.metadata.labels?.["eks.amazonaws.com/compute-type"])) return "eks";
  if (/-gke\./.test(git) || n.some((x) => x.metadata.labels?.["cloud.google.com/gke-nodepool"])) return "gke";
  if (n.some((x) => x.metadata.labels?.["kubernetes.azure.com/cluster"])) return "aks";
  if (/\+k3s/.test(kubelet) || /\+k3s/.test(git)) return "k3s";
  if (/\+rke2/.test(kubelet) || /\+rke2/.test(git)) return "rke2";
  if (/talos/i.test(os)) return "talos";
  if (snap.kubeadmConfig) return "kubeadm";
  if (provider.startsWith("aws://")) return "eks";
  if (provider.startsWith("gce://")) return "gke";
  if (provider.startsWith("azure://")) return "aks";
  return "unknown";
}

export const MANAGED = new Set(["eks", "gke", "aks"]);

// Versions of every kube-apiserver instance: static pods where visible, else control-plane
// kubelets (k3s/RKE2 embed the apiserver), else /version (managed).
export function apiserverVersions(snap, distro) {
  const pods = snap.pods.filter((p) => p.metadata.namespace === "kube-system"
    && (p.metadata.labels?.component === "kube-apiserver" || p.metadata.labels?.["k8s-app"] === "kube-apiserver"));
  const fromPods = pods.map((p) => p.spec.containers[0].image.split(":").pop()).filter((t) => parseVersion(t));
  if (fromPods.length) return fromPods;
  if (distro === "k3s" || distro === "rke2") return snap.nodes.filter(isControlPlane).map((x) => x.status.nodeInfo.kubeletVersion);
  return [snap.version.gitVersion];
}

export function nodeInfo(snap) {
  return snap.nodes.map((n) => ({
    name: n.metadata.name,
    controlPlane: isControlPlane(n),
    etcd: "node-role.kubernetes.io/etcd" in (n.metadata.labels ?? {}),
    ready: isReady(n),
    unschedulable: !!n.spec.unschedulable,
    kubelet: n.status.nodeInfo.kubeletVersion,
    runtime: n.status.nodeInfo.containerRuntimeVersion,
    os: n.status.nodeInfo.osImage,
    kernel: n.status.nodeInfo.kernelVersion,
    pool: n.metadata.labels?.["eks.amazonaws.com/nodegroup"] ?? n.metadata.labels?.["cloud.google.com/gke-nodepool"] ?? n.metadata.labels?.agentpool ?? null,
  }));
}

// Removed-API usage the apiserver has seen since its start (only the instance that answered).
export function deprecatedApiMetrics(metrics) {
  if (!metrics) return null;
  return [...metrics.matchAll(/^apiserver_requested_deprecated_apis\{([^}]*)\}\s+1/gm)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])))
    .map((l) => ({ group: l.group, version: l.version, resource: l.resource, removedRelease: l.removed_release || null }))
    .filter((l) => l.removedRelease);
}

// ---------- HA checks ----------

const cpu = (q) => (!q ? 0 : q.endsWith("m") ? Number(q.slice(0, -1)) : Number(q) * 1000);
const mem = (q) => {
  if (!q) return 0;
  const m = String(q).match(/^(\d+(?:\.\d+)?)([KMGTE]i?)?$/);
  const mult = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 };
  return m ? Number(m[1]) * (mult[m[2]] ?? 1) : 0;
};

const podOwnerRef = (p) => p.metadata.ownerReferences?.[0];
const matches = (sel, labels) => !!sel && Object.entries(sel.matchLabels ?? {}).every(([k, v]) => labels?.[k] === v)
  && (sel.matchExpressions ?? []).every((e) => {
    const has = labels && e.key in labels;
    if (e.operator === "In") return has && e.values.includes(labels[e.key]);
    if (e.operator === "NotIn") return !has || !e.values.includes(labels[e.key]);
    if (e.operator === "Exists") return has;
    if (e.operator === "DoesNotExist") return !has;
    return false;
  });

// exceptions: [{check, target}] from k8s-upgrades.json; matching findings are dropped.
export function haChecks(snap, distro, exceptions = []) {
  const findings = [];
  const add = (level, check, target, what) => {
    if (!exceptions.some((e) => e.check === check && e.target === target)) findings.push({ level, check, target, what });
  };
  const nodes = nodeInfo(snap);
  const cps = nodes.filter((n) => n.controlPlane);

  // Control plane and etcd quorum.
  if (!MANAGED.has(distro)) {
    if (cps.length === 1) add("high", "single-control-plane", cps[0].name, "one control-plane node: the API is down while it upgrades");
    else if (cps.length % 2 === 0) add("medium", "even-control-plane", `${cps.length} nodes`, "even control-plane count: no extra fault tolerance over n-1, and stacked etcd loses quorum sooner");
    const etcdMembers = snap.pods.filter((p) => p.metadata.namespace === "kube-system" && p.metadata.labels?.component === "etcd").length
      || nodes.filter((n) => n.etcd).length;
    if (etcdMembers === 2) add("critical", "etcd-quorum", "etcd", "2 etcd members: losing one during the upgrade loses quorum");
    if (etcdMembers && etcdMembers % 2 === 0 && etcdMembers !== 2) add("medium", "etcd-quorum", "etcd", `${etcdMembers} etcd members: use an odd count`);
  }
  for (const n of nodes.filter((x) => !x.ready)) add("critical", "node-not-ready", n.name, "node not Ready: fix before upgrading");
  for (const n of nodes.filter((x) => x.unschedulable)) add("medium", "node-cordoned", n.name, "node already cordoned: a previous upgrade may not have finished");
  if (snap.readyz && !/readyz check passed/.test(snap.readyz)) add("critical", "apiserver-readyz", "kube-apiserver", `/readyz failing: ${snap.readyz.split("\n").filter((l) => /failed/.test(l)).join("; ")}`);

  // Drain blockers: PDBs that allow no disruption, workloads that lose all replicas on one node.
  for (const p of snap.pdbs) {
    if ((p.status?.expectedPods ?? 0) > 0 && p.status?.disruptionsAllowed === 0) {
      add("high", "pdb-blocks-drain", `${p.metadata.namespace}/${p.metadata.name}`, `PDB allows 0 disruptions (${p.status.currentHealthy}/${p.status.expectedPods} healthy): kubectl drain hangs on its pods`);
    }
  }
  const rsOwner = new Map(); // ReplicaSet -> Deployment via pod-template-hash naming
  for (const p of snap.pods) {
    const o = podOwnerRef(p);
    if (o?.kind === "ReplicaSet") rsOwner.set(`${p.metadata.namespace}/${o.name}`, `${p.metadata.namespace}/${o.name.replace(/-[a-z0-9]+$/, "")}`);
  }
  for (const w of snap.workloads.filter((x) => x.kind !== "DaemonSet")) {
    const ref = `${w.metadata.namespace}/${w.metadata.name}`;
    const replicas = w.spec.replicas ?? 1;
    if (replicas === 0) continue;
    const pods = snap.pods.filter((p) => {
      const o = podOwnerRef(p);
      return o && p.metadata.namespace === w.metadata.namespace
        && ((o.kind === "ReplicaSet" && rsOwner.get(`${p.metadata.namespace}/${o.name}`) === ref) || (o.kind === w.kind && o.name === w.metadata.name));
    });
    const nodesUsed = new Set(pods.map((p) => p.spec.nodeName).filter(Boolean));
    if (replicas === 1) add("medium", "single-replica", `${w.kind}/${ref}`, "1 replica: down while its node drains");
    else if (nodesUsed.size === 1 && pods.length > 1) add("high", "replicas-one-node", `${w.kind}/${ref}`, `all ${pods.length} replicas on ${[...nodesUsed][0]}: down while it drains (no anti-affinity or topology spread)`);
    const hasPdb = snap.pdbs.some((pdb) => pdb.metadata.namespace === w.metadata.namespace && matches(pdb.spec.selector, w.spec.template.metadata.labels));
    if (replicas > 1 && !hasPdb) add("low", "no-pdb", `${w.kind}/${ref}`, `${replicas} replicas without a PDB: a drain may evict several at once`);
  }

  // Node-pinned storage: pods on local volumes cannot move while their node drains.
  const pinnedPv = new Map(snap.pvs.filter((pv) => pv.spec.nodeAffinity?.required || pv.spec.local || pv.spec.hostPath)
    .map((pv) => [pv.metadata.name, pv.spec.nodeAffinity?.required?.nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.values?.[0] ?? null]));
  const pvcToPv = new Map(snap.pvcs.map((c) => [`${c.metadata.namespace}/${c.metadata.name}`, c.spec.volumeName]));
  const ownerName = (p) => {
    const o = podOwnerRef(p);
    return o?.kind === "ReplicaSet" ? rsOwner.get(`${p.metadata.namespace}/${o.name}`) : `${p.metadata.namespace}/${o?.name ?? p.metadata.name}`;
  };
  const pinned = new Map(); // workload -> nodes it is pinned to
  for (const p of snap.pods) {
    for (const v of p.spec.volumes ?? []) {
      const pv = v.persistentVolumeClaim && pvcToPv.get(`${p.metadata.namespace}/${v.persistentVolumeClaim.claimName}`);
      if (!pv || !pinnedPv.has(pv)) continue;
      const w = ownerName(p);
      if (!pinned.has(w)) pinned.set(w, new Set());
      pinned.get(w).add(p.spec.nodeName ?? pinnedPv.get(pv));
    }
  }
  for (const [w, on] of pinned) {
    if (on.size === 1) add("high", "node-local-storage", w, `on a node-local volume on ${[...on][0]}: down until that node returns`);
    else add("medium", "node-local-storage", w, `replicas on node-local volumes on ${on.size} nodes: drain one node at a time and wait until the replica has rejoined`);
  }

  // Spare capacity: the largest node's requests must fit on the others.
  const req = new Map();
  for (const p of snap.pods.filter((x) => x.spec.nodeName && !["Succeeded", "Failed"].includes(x.status?.phase))) {
    const r = req.get(p.spec.nodeName) ?? { cpu: 0, mem: 0 };
    for (const c of p.spec.containers) { r.cpu += cpu(c.resources?.requests?.cpu); r.mem += mem(c.resources?.requests?.memory); }
    req.set(p.spec.nodeName, r);
  }
  const workers = snap.nodes.filter((n) => !isControlPlane(n) || !n.spec.taints?.some((t) => t.effect === "NoSchedule"));
  if (workers.length > 1) {
    const free = workers.map((n) => {
      const r = req.get(n.metadata.name) ?? { cpu: 0, mem: 0 };
      return { name: n.metadata.name, cpu: cpu(n.status.allocatable.cpu) - r.cpu, mem: mem(n.status.allocatable.memory) - r.mem, used: r };
    });
    const biggest = free.reduce((a, b) => (b.used.cpu + b.used.mem / 1e6 > a.used.cpu + a.used.mem / 1e6 ? b : a));
    const rest = free.filter((f) => f !== biggest);
    const restCpu = rest.reduce((s, f) => s + f.cpu, 0), restMem = rest.reduce((s, f) => s + f.mem, 0);
    if (biggest.used.cpu > restCpu || biggest.used.mem > restMem) {
      add("high", "drain-capacity", biggest.name, `draining ${biggest.name} needs ${Math.round(biggest.used.cpu)}m CPU / ${Math.round(biggest.used.mem / 2 ** 20)}Mi requested, others have ${Math.round(restCpu)}m / ${Math.round(restMem / 2 ** 20)}Mi free: add a surge node first`);
    }
  }

  // Webhooks with failurePolicy Fail whose service has no ready endpoint block API writes mid-upgrade.
  for (const wh of snap.webhooks) {
    for (const h of wh.webhooks ?? []) {
      const svc = h.clientConfig?.service;
      if (h.failurePolicy !== "Fail" || !svc) continue;
      const sel = snap.services?.find((x) => x.metadata.namespace === svc.namespace && x.metadata.name === svc.name)?.spec.selector;
      const w = sel && snap.workloads.find((x) => x.metadata.namespace === svc.namespace && x.kind !== "DaemonSet" && matches({ matchLabels: sel }, x.spec.template.metadata.labels));
      if (w && (w.spec.replicas ?? 1) === 1) add("medium", "webhook-single-replica", `${wh.kind}/${wh.metadata.name}`, `failurePolicy Fail and backed by 1 replica (${w.metadata.namespace}/${w.metadata.name}): matching API writes fail while it moves`);
    }
  }
  // Aggregated APIs that are unavailable break kubectl discovery and namespace deletion.
  for (const a of snap.apiservices.filter((x) => x.spec.service && x.status?.conditions?.some((c) => c.type === "Available" && c.status !== "True"))) {
    add("high", "apiservice-unavailable", a.metadata.name, "aggregated API unavailable");
  }
  return findings;
}

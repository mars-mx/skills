import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changelogExtract, compareVersions, cveAffects, eolStatus, fixFor, manifestKinds, minorOf, parseCve, parsePluto,
  readyForMinor, removedBy, severityOf, skewFindings, tagVersion, upgradePath,
} from "./lib.mjs";
import { detectDistro, haChecks, apiserverVersions, deprecatedApiMetrics } from "./cluster.mjs";
import { goModule, inventory, matchComponent, splitImage } from "./components.mjs";

const NOW = Date.parse("2026-10-28T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

test("versions order across upstream and distro builds", () => {
  assert.equal(compareVersions("v1.33.13+k3s2", "v1.33.13+k3s1"), 1);
  assert.equal(compareVersions("1.34.0", "v1.33.99"), 1);
  assert.equal(compareVersions("1.34.0-rc.1", "1.34.0"), -1);
  assert.equal(minorOf("v1.33.13+k3s2"), "1.33");
  assert.equal(tagVersion("controller-v1.12.1", "controller-"), "1.12.1");
  assert.equal(tagVersion("helm-chart-4.12.0", "controller-"), null);
  assert.equal(tagVersion("metrics-server-helm-chart-3.14.0", "v"), null);
  assert.equal(tagVersion("v1.34.2+k3s1"), "1.34.2+k3s1");
});

const rel = (version, days) => ({ version, time: daysAgo(days) });
const releases = [
  rel("1.33.10", 200), rel("1.33.11", 60), rel("1.33.12", 5),
  rel("1.34.0", 120), rel("1.34.1", 90), rel("1.34.5", 20),
  rel("1.35.0", 40), rel("1.35.1", 10),
  rel("1.36.0", 3),
];

test("path: cooled patch, one minor at a time, a .0 alone never qualifies", () => {
  const p = upgradePath({ current: "1.33.10", releases, cooldownDays: 14, now: NOW });
  assert.equal(p.patch, "1.33.11");
  // 1.35.1 is inside the cooldown and 1.35.0 alone does not qualify.
  assert.deepEqual(p.steps, ["1.34.5"]);
  assert.equal(p.target, "1.34.5");
  assert.equal(p.minorsBehind, 3);
  const capped = upgradePath({ current: "1.33.10", releases, cooldownDays: 7, now: NOW, maxMinor: "1.34" });
  assert.deepEqual(capped.steps, ["1.34.5"]);
  const longer = upgradePath({ current: "1.33.10", releases, cooldownDays: 7, now: NOW });
  assert.deepEqual(longer.steps, ["1.34.5", "1.35.1"]);
});

test("end of life: past, near, and extended support", () => {
  const cycles = [{ cycle: "1.33", eol: "2026-06-28" }, { cycle: "1.34", eol: "2026-12-01", extendedSupport: "2027-12-01" }];
  const past = eolStatus(cycles, "v1.33.13+k3s2", NOW);
  assert.ok(past.daysLeft < 0);
  assert.equal(severityOf({ eol: past }).severity, "critical");
  assert.equal(severityOf({ eol: past, eolPast: "high" }).severity, "high");
  assert.equal(severityOf({ eol: eolStatus(cycles, "1.34.2", NOW) }).severity, "high");
  assert.equal(eolStatus(cycles, "1.30.0", NOW), null);
});

const item = (id, text, severity = "Medium (5.8)") => ({ id, url: "u", date_published: "2026-09-01", summary: id, content_text: `CVSS Rating: x - ${severity}\n\n${text}` });

test("CVE feed: all three version formats parse and match by minor", () => {
  const a = parseCve(item("A", "#### Affected Versions\n\nkubelet: <= v1.34.11\nkubelet: <= v1.35.8\n\n#### Fixed Versions\n\nkubelet: >= v1.34.12\nkubelet: >= v1.35.9\n"));
  assert.equal(a.severity, "medium");
  assert.equal(cveAffects(a, "kubelet", "v1.34.3"), true);
  assert.equal(cveAffects(a, "kubelet", "v1.35.9"), false);
  // An older minor than every fix got no backport.
  assert.equal(cveAffects(a, "kubelet", "v1.33.13+k3s2"), true);
  assert.equal(cveAffects(a, "kubelet", "v1.36.0"), false);
  assert.equal(cveAffects(a, "kube-proxy", "v1.34.3"), false);
  assert.equal(fixFor(a, "kubelet", "v1.33.1"), "1.34.12");
  const b = parseCve(item("B", "### Affected Versions\n\n- kubectl v1.34.0 to v1.34.11\n\n### Fixed Versions\n\n- kubectl >= v1.34.12\n"));
  assert.equal(cveAffects(b, "kubectl", "1.34.5"), true);
  const c = parseCve(item("C", "### Affected Versions\n\n- ingress-nginx: < v1.13.9\n- ingress-nginx: < v1.14.5\n", "High (8.8)"));
  assert.equal(c.severity, "high");
  assert.equal(cveAffects(c, "ingress-nginx", "1.14.1"), true);
  assert.equal(cveAffects(c, "ingress-nginx", "1.14.5"), false);
});

test("removed APIs from the pluto list and manifests", () => {
  const pluto = parsePluto(`deprecated-versions:\n  - version: flowcontrol.apiserver.k8s.io/v1beta3\n    kind: FlowSchema\n    deprecated-in: v1.29.0\n    removed-in: v1.32.0\n    replacement-api: flowcontrol.apiserver.k8s.io/v1\n    replacement-available-in: v1.29.0\n    component: k8s\n  - version: cert-manager.io/v1alpha2\n    kind: Certificate\n    deprecated-in: v0.11.0\n    removed-in: v1.6.0\n    replacement-api: cert-manager.io/v1\n    component: cert-manager\n`);
  assert.equal(pluto.length, 2);
  assert.deepEqual(removedBy(pluto, "1.31", "1.33").map((e) => e.kind), ["FlowSchema"]);
  assert.deepEqual(removedBy(pluto, "1.32", "1.34"), []);
  assert.deepEqual(manifestKinds("apiVersion: v1\nkind: ConfigMap\n---\n# c\napiVersion: 'flowcontrol.apiserver.k8s.io/v1beta3'\nkind: FlowSchema\nspec:\n  kind: x\n"),
    [{ apiVersion: "v1", kind: "ConfigMap" }, { apiVersion: "flowcontrol.apiserver.k8s.io/v1beta3", kind: "FlowSchema" }]);
  const m = deprecatedApiMetrics(`apiserver_requested_deprecated_apis{group="",removed_release="",resource="endpoints",subresource="",version="v1"} 1\napiserver_requested_deprecated_apis{group="flowcontrol.apiserver.k8s.io",removed_release="1.32",resource="flowschemas",subresource="",version="v1beta3"} 1\n`);
  assert.deepEqual(m, [{ group: "flowcontrol.apiserver.k8s.io", version: "v1beta3", resource: "flowschemas", removedRelease: "1.32" }]);
});

test("version skew policy", () => {
  const nodes = [{ name: "a", kubelet: "v1.33.1" }, { name: "b", kubelet: "v1.30.2" }, { name: "c", kubelet: "v1.29.0" }];
  const s = skewFindings({ apiservers: ["v1.33.1", "v1.33.1"], nodes });
  assert.deepEqual(s.map((x) => `${x.level}:${x.what.split(":")[0]}`), ["high:b", "critical:c"]);
  // 2 minors behind is still supported but blocks the next control-plane step.
  assert.equal(skewFindings({ apiservers: ["v1.33.1"], nodes: [{ name: "d", kubelet: "v1.31.0" }] })[0].level, "high");
  assert.equal(skewFindings({ apiservers: ["v1.33.0", "v1.31.0"], nodes: [] })[0].level, "critical");
  assert.deepEqual(readyForMinor({ apiservers: ["v1.33.1"], nodes, target: "1.34" }), ["b: kubelet v1.30.2 must reach 1.32 first", "c: kubelet v1.29.0 must reach 1.32 first"]);
  assert.deepEqual(readyForMinor({ apiservers: ["v1.33.1"], nodes: [nodes[0]], target: "1.35" }), ["kube-apiserver v1.33.1 would skip a minor"]);
});

test("changelog extract keeps urgent notes, deprecations, and API changes", () => {
  const md = "# v1.35.1\n\n## Changes\n\n# v1.35.0\n\n## Downloads\n\nx\n\n## Urgent Upgrade Notes\n\n- cgroup v1 removed\n\n## Changes by Kind\n\n### Deprecation\n\n- flag gone\n\n### Feature\n\n- shiny\n\n### API Change\n\n- field added\n\n# v1.35.0-rc.1\n\n## Urgent Upgrade Notes\n- rc\n";
  const ex = changelogExtract(md, "1.35");
  assert.match(ex, /cgroup v1 removed/);
  assert.match(ex, /flag gone/);
  assert.match(ex, /field added/);
  assert.doesNotMatch(ex, /shiny|rc$/m);
});

// ---------- cluster fixtures ----------

const node = (name, { cp = false, etcd = false, kubelet = "v1.33.13+k3s2", os = "Ubuntu 24.04", labels = {}, provider, ready = true, cpu = "4", memory = "8Gi" } = {}) => ({
  metadata: { name, labels: { ...(cp ? { "node-role.kubernetes.io/control-plane": "true" } : {}), ...(etcd ? { "node-role.kubernetes.io/etcd": "true" } : {}), ...labels } },
  spec: { ...(provider ? { providerID: provider } : {}) },
  status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }], allocatable: { cpu, memory }, nodeInfo: { kubeletVersion: kubelet, osImage: os, containerRuntimeVersion: "containerd://2.0", kernelVersion: "6.8" } },
});
const deploy = (ns, name, replicas, image, labels = {}) => ({ kind: "Deployment", metadata: { namespace: ns, name, labels }, spec: { replicas, template: { metadata: { labels: { app: name } }, spec: { containers: [{ image }] } } } });
const pod = (ns, name, owner, nodeName, extra = {}) => ({ metadata: { namespace: ns, name, ownerReferences: [owner] }, spec: { nodeName, containers: [{ resources: { requests: { cpu: "100m", memory: "128Mi" } } }], ...extra }, status: { phase: "Running" } });
const empty = { version: { gitVersion: "v1.33.13+k3s2" }, nodes: [], workloads: [], pods: [], pdbs: [], pvs: [], pvcs: [], services: [], crds: [], webhooks: [], apiservices: [], kubeadmConfig: null, readyz: "readyz check passed" };

test("distro detection", () => {
  assert.equal(detectDistro({ ...empty, nodes: [node("a")] }), "k3s");
  assert.equal(detectDistro({ ...empty, version: { gitVersion: "v1.33.5+rke2r1" }, nodes: [node("a", { kubelet: "v1.33.5+rke2r1" })] }), "rke2");
  assert.equal(detectDistro({ ...empty, version: { gitVersion: "v1.33.5" }, nodes: [node("a", { kubelet: "v1.33.5", os: "Talos (v1.10.0)" })] }), "talos");
  assert.equal(detectDistro({ ...empty, version: { gitVersion: "v1.33.5" }, nodes: [node("a", { kubelet: "v1.33.5" })], kubeadmConfig: {} }), "kubeadm");
  assert.equal(detectDistro({ ...empty, version: { gitVersion: "v1.33.5-eks-abc" }, nodes: [node("a", { kubelet: "v1.33.5-eks-1" })] }), "eks");
  assert.equal(detectDistro({ ...empty, version: { gitVersion: "v1.33.5-gke.100" }, nodes: [node("a", { kubelet: "v1.33.5-gke.100" })] }), "gke");
  assert.equal(detectDistro({ ...empty, version: { gitVersion: "v1.33.5" }, nodes: [node("a", { kubelet: "v1.33.5", labels: { "kubernetes.azure.com/cluster": "x" } })] }), "aks");
});

test("apiserver versions come from static pods, else control-plane kubelets", () => {
  const kubeadm = { ...empty, pods: [{ metadata: { namespace: "kube-system", labels: { component: "kube-apiserver" } }, spec: { containers: [{ image: "registry.k8s.io/kube-apiserver:v1.33.4" }] } }] };
  assert.deepEqual(apiserverVersions(kubeadm, "kubeadm"), ["v1.33.4"]);
  const k3s = { ...empty, nodes: [node("cp1", { cp: true }), node("cp2", { cp: true, kubelet: "v1.34.1+k3s1" }), node("w1")] };
  assert.deepEqual(apiserverVersions(k3s, "k3s"), ["v1.33.13+k3s2", "v1.34.1+k3s1"]);
});

test("HA checks: quorum, drain blockers, replicas on one node, node-local storage", () => {
  const rs = (name) => ({ kind: "ReplicaSet", name });
  const snap = {
    ...empty,
    nodes: [node("cp1", { cp: true, etcd: true }), node("cp2", { cp: true, etcd: true }), node("w1"), node("w2")],
    workloads: [deploy("app", "web", 2, "nginx:1"), deploy("app", "solo", 1, "nginx:1"), { ...deploy("db", "pg", 1, "postgres:16"), kind: "StatefulSet" }],
    pods: [
      pod("app", "web-abc12-x", rs("web-abc12"), "w1"), pod("app", "web-abc12-y", rs("web-abc12"), "w1"),
      pod("app", "solo-def34-z", rs("solo-def34"), "w2"),
      pod("db", "pg-0", { kind: "StatefulSet", name: "pg" }, "w2", { volumes: [{ persistentVolumeClaim: { claimName: "data-pg-0" } }] }),
    ],
    pdbs: [{ metadata: { namespace: "app", name: "solo" }, spec: { selector: { matchLabels: { app: "solo" } } }, status: { expectedPods: 1, currentHealthy: 1, disruptionsAllowed: 0 } }],
    pvcs: [{ metadata: { namespace: "db", name: "data-pg-0" }, spec: { volumeName: "pv1" } }],
    pvs: [{ metadata: { name: "pv1" }, spec: { local: { path: "/data" }, nodeAffinity: { required: { nodeSelectorTerms: [{ matchExpressions: [{ values: ["w2"] }] }] } } } }],
  };
  const f = haChecks(snap, "k3s");
  const has = (check, target) => f.some((x) => x.check === check && (!target || x.target === target));
  assert.ok(has("etcd-quorum"), "2 etcd members lose quorum");
  assert.ok(has("even-control-plane"));
  assert.ok(has("pdb-blocks-drain", "app/solo"));
  assert.ok(has("replicas-one-node", "Deployment/app/web"));
  assert.ok(has("single-replica", "Deployment/app/solo"));
  assert.ok(has("no-pdb", "Deployment/app/web"));
  assert.ok(has("node-local-storage", "db/pg"));
  const excepted = haChecks(snap, "k3s", [{ check: "single-replica", target: "Deployment/app/solo" }]);
  assert.ok(!excepted.some((x) => x.check === "single-replica" && x.target === "Deployment/app/solo"));
  // Managed control planes skip quorum checks.
  assert.ok(!haChecks(snap, "eks").some((x) => x.check === "etcd-quorum"));
});

test("component inventory: mirrored images, bundled images, owners", () => {
  assert.deepEqual(splitImage("quay.io/cilium/cilium:v1.20.4@sha256:abc"), { repo: "quay.io/cilium/cilium", tag: "v1.20.4" });
  assert.deepEqual(splitImage("localhost:5000/x"), { repo: "localhost:5000/x", tag: null });
  assert.equal(matchComponent("rancher/mirrored-coredns-coredns:1.12.0").name, "coredns");
  assert.equal(matchComponent("registry.k8s.io/ingress-nginx/controller:v1.12.1").name, "ingress-nginx");
  assert.equal(matchComponent("ghcr.io/example/app:1.0"), null);
  assert.equal(goModule({ go: "github.com/argoproj/argo-cd+v" }, "v3.5.6"), "github.com/argoproj/argo-cd/v3");
  assert.equal(goModule({ go: "github.com/cilium/cilium" }, "v1.20.4"), "github.com/cilium/cilium");
  const inv = inventory([
    deploy("kube-system", "coredns", 2, "rancher/mirrored-coredns-coredns:1.12.0", { "objectset.rio.cattle.io/hash": "x" }),
    { ...deploy("kube-system", "cilium", 1, "quay.io/cilium/cilium:v1.20.4"), kind: "DaemonSet" },
    deploy("kube-system", "hubble-ui", 1, "quay.io/cilium/hubble-ui:v0.13.6"),
    deploy("kube-system", "mystery", 1, "example.com/thing:2.0"),
    deploy("app", "web", 1, "example.com/web:1.0"),
  ]);
  const by = Object.fromEntries(inv.components.map((c) => [c.name, c]));
  assert.equal(by.coredns.mirrored, true);
  assert.deepEqual(by.coredns.owners, ["distro-addon"]);
  assert.deepEqual(by.cilium.versions, ["v1.20.4"], "hubble does not mix its version into cilium");
  assert.equal(by.cilium.workloads.length, 2);
  assert.deepEqual(inv.unmapped.map((u) => u.image), ["example.com/thing"]);
});

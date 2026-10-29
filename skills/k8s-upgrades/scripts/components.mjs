// Known cluster components: image pattern -> GitHub repo for releases, endoflife.date product,
// and Go module for OSV. Unknown images in system namespaces are reported as unmapped.
import { parseVersion } from "./lib.mjs";

// match: tested against the image without registry tag/digest ("quay.io/cilium/cilium").
// prefix: release tag prefix in a monorepo. eol: endoflife.date product.
// go: OSV Go module ("+v" appends /vN for majors >= 2). k8sMinor: minor must match the cluster's.
export const COMPONENTS = [
  { name: "coredns", match: /coredns$/, repo: "coredns/coredns", go: "github.com/coredns/coredns" },
  { name: "metrics-server", match: /metrics-server$/, repo: "kubernetes-sigs/metrics-server", prefix: "v", go: "sigs.k8s.io/metrics-server" },
  { name: "kube-proxy", match: /\/kube-proxy$/, core: true },
  { name: "etcd", match: /(^|\/)etcd$/, repo: "etcd-io/etcd", eol: "etcd", go: "go.etcd.io/etcd/server/v3" },
  { name: "cilium", match: /cilium\/(cilium|operator(-generic|-aws|-azure)?)$/, repo: "cilium/cilium", eol: "cilium", go: "github.com/cilium/cilium" },
  { name: "hubble", match: /cilium\/hubble-(relay|ui(-backend)?)$/, bundledWith: "cilium" },
  { name: "calico", match: /calico\/(node|kube-controllers|typha|cni)$/, repo: "projectcalico/calico", eol: "calico", go: "github.com/projectcalico/calico" },
  { name: "flannel", match: /flannel(-io)?\/flannel$/, repo: "flannel-io/flannel", go: "github.com/flannel-io/flannel" },
  { name: "cert-manager", match: /jetstack\/cert-manager-(controller|cainjector|webhook)$/, repo: "cert-manager/cert-manager", eol: "cert-manager", go: "github.com/cert-manager/cert-manager" },
  { name: "trust-manager", match: /jetstack\/trust-manager$/, repo: "cert-manager/trust-manager" },
  { name: "argo-cd", match: /argoproj\/argocd$/, repo: "argoproj/argo-cd", eol: "argo-cd", go: "github.com/argoproj/argo-cd+v" },
  { name: "ingress-nginx", match: /ingress-nginx\/controller$/, repo: "kubernetes/ingress-nginx", prefix: "controller-", feed: "ingress-nginx" },
  { name: "traefik", match: /(^|\/)traefik$/, repo: "traefik/traefik", eol: "traefik", go: "github.com/traefik/traefik+v" },
  { name: "envoy-gateway", match: /envoyproxy\/gateway$/, repo: "envoyproxy/gateway", go: "github.com/envoyproxy/gateway" },
  { name: "envoy", match: /envoyproxy\/envoy$/, repo: "envoyproxy/envoy" },
  { name: "istio", match: /istio\/(pilot|proxyv2)$/, repo: "istio/istio", eol: "istio", go: "istio.io/istio" },
  { name: "external-dns", match: /external-dns$/, repo: "kubernetes-sigs/external-dns", prefix: "v", eol: "external-dns", go: "sigs.k8s.io/external-dns" },
  { name: "keda", match: /kedacore\/keda(-metrics-apiserver|-admission-webhooks)?$/, repo: "kedacore/keda", eol: "keda", go: "github.com/kedacore/keda+v" },
  { name: "longhorn", match: /longhornio\/longhorn-manager$/, repo: "longhorn/longhorn", eol: "longhorn" },
  { name: "velero", match: /velero\/velero$/, repo: "vmware-tanzu/velero", go: "github.com/vmware-tanzu/velero" },
  { name: "kube-vip", match: /kube-vip\/kube-vip(-iptables)?$/, repo: "kube-vip/kube-vip", go: "github.com/kube-vip/kube-vip" },
  { name: "cluster-autoscaler", match: /autoscaling\/cluster-autoscaler$/, repo: "kubernetes/autoscaler", prefix: "cluster-autoscaler-", k8sMinor: true },
  { name: "karpenter", match: /karpenter\/controller$/, repo: "aws/karpenter-provider-aws" },
  { name: "aws-load-balancer-controller", match: /aws-load-balancer-controller$/, repo: "kubernetes-sigs/aws-load-balancer-controller" },
  { name: "aws-ebs-csi-driver", match: /aws-ebs-csi-driver$/, repo: "kubernetes-sigs/aws-ebs-csi-driver" },
  { name: "hcloud-cloud-controller-manager", match: /hetznercloud\/hcloud-cloud-controller-manager$/, repo: "hetznercloud/hcloud-cloud-controller-manager" },
  { name: "hcloud-csi-driver", match: /hetznercloud\/hcloud-csi-driver$/, repo: "hetznercloud/csi-driver" },
  { name: "local-path-provisioner", match: /local-path-provisioner$/, repo: "rancher/local-path-provisioner" },
  { name: "csi-attacher", match: /sig-storage\/csi-attacher$/, repo: "kubernetes-csi/external-attacher" },
  { name: "csi-provisioner", match: /sig-storage\/csi-provisioner$/, repo: "kubernetes-csi/external-provisioner" },
  { name: "csi-resizer", match: /sig-storage\/csi-resizer$/, repo: "kubernetes-csi/external-resizer" },
  { name: "csi-snapshotter", match: /sig-storage\/(csi-snapshotter|snapshot-controller)$/, repo: "kubernetes-csi/external-snapshotter" },
  { name: "csi-node-driver-registrar", match: /sig-storage\/csi-node-driver-registrar$/, repo: "kubernetes-csi/node-driver-registrar", eol: "kubernetes-csi-node-driver-registrar" },
  { name: "csi-livenessprobe", match: /sig-storage\/livenessprobe$/, repo: "kubernetes-csi/livenessprobe" },
  { name: "csi-driver-nfs", match: /sig-storage\/nfsplugin$/, repo: "kubernetes-csi/csi-driver-nfs", feed: "csi driver for nfs" },
  { name: "csi-driver-smb", match: /sig-storage\/smbplugin$/, repo: "kubernetes-csi/csi-driver-smb", feed: "csi driver for smb" },
  { name: "kube-state-metrics", match: /kube-state-metrics$/, repo: "kubernetes/kube-state-metrics", go: "k8s.io/kube-state-metrics+v" },
  { name: "node-exporter", match: /prometheus\/node-exporter$/, repo: "prometheus/node_exporter" },
  { name: "prometheus", match: /prometheus\/prometheus$/, repo: "prometheus/prometheus", eol: "prometheus" },
  { name: "prometheus-operator", match: /prometheus-operator\/prometheus-operator$/, repo: "prometheus-operator/prometheus-operator", go: "github.com/prometheus-operator/prometheus-operator" },
  { name: "grafana-alloy", match: /grafana\/alloy$/, repo: "grafana/alloy" },
  { name: "opentelemetry-collector", match: /opentelemetry-collector(-contrib|-k8s)?$/, repo: "open-telemetry/opentelemetry-collector-releases" },
  { name: "sealed-secrets", match: /sealed-secrets-controller$/, repo: "bitnami-labs/sealed-secrets", go: "github.com/bitnami-labs/sealed-secrets" },
  { name: "external-secrets", match: /external-secrets\/external-secrets$/, repo: "external-secrets/external-secrets", go: "github.com/external-secrets/external-secrets" },
  { name: "flux-source-controller", match: /fluxcd\/source-controller$/, repo: "fluxcd/source-controller", eol: "flux" },
  { name: "flux-kustomize-controller", match: /fluxcd\/kustomize-controller$/, repo: "fluxcd/kustomize-controller" },
  { name: "flux-helm-controller", match: /fluxcd\/helm-controller$/, repo: "fluxcd/helm-controller" },
  { name: "flux-notification-controller", match: /fluxcd\/notification-controller$/, repo: "fluxcd/notification-controller" },
  { name: "system-upgrade-controller", match: /rancher\/system-upgrade-controller$/, repo: "rancher/system-upgrade-controller" },
];

// CRD-installed components without a workload image: version from a CRD annotation.
export const CRD_COMPONENTS = [
  { name: "gateway-api", crd: "gateways.gateway.networking.k8s.io", annotation: "gateway.networking.k8s.io/bundle-version", repo: "kubernetes-sigs/gateway-api" },
];

const SYSTEM_NS = /^(kube-system|kube-public|kube-node-lease|.*-system|cattle-.*|calico-.*|tigera-operator|cert-manager|argocd|flux-system|ingress-nginx|metallb-system|longhorn-system|monitoring|velero)$/;

// "quay.io/cilium/cilium:v1.20.4@sha256:..." -> {repo: "quay.io/cilium/cilium", tag: "v1.20.4"}
export function splitImage(image) {
  const noDigest = image.split("@")[0];
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  return colon > slash ? { repo: noDigest.slice(0, colon), tag: noDigest.slice(colon + 1) } : { repo: noDigest, tag: null };
}

// k3s and RKE2 mirror their bundled images under rancher/mirrored-<org>-<name>.
const unmirror = (repo) => repo.replace(/rancher\/mirrored-(?:library-)?/, "").replace(/^(coredns|metrics-server)-/, "$1/");

export function matchComponent(image) {
  const { repo } = splitImage(image);
  const r = unmirror(repo);
  return COMPONENTS.find((c) => c.match.test(r) || c.match.test(repo)) ?? null;
}

export function goModule(c, version) {
  if (!c.go) return null;
  const major = parseVersion(version)?.nums[0] ?? 0;
  return c.go.endsWith("+v") ? `${c.go.slice(0, -2)}${major >= 2 ? `/v${major}` : ""}` : c.go;
}

// Who changes this workload: GitOps controllers revert direct changes.
export function ownerOf(obj) {
  const l = obj.metadata?.labels ?? {}, a = obj.metadata?.annotations ?? {};
  if (l["argocd.argoproj.io/instance"] || a["argocd.argoproj.io/tracking-id"]) return `argocd:${l["argocd.argoproj.io/instance"] ?? a["argocd.argoproj.io/tracking-id"].split(":")[0]}`;
  if (l["helm.toolkit.fluxcd.io/name"]) return `flux-helm:${l["helm.toolkit.fluxcd.io/namespace"]}/${l["helm.toolkit.fluxcd.io/name"]}`;
  if (l["kustomize.toolkit.fluxcd.io/name"]) return `flux-kustomize:${l["kustomize.toolkit.fluxcd.io/namespace"]}/${l["kustomize.toolkit.fluxcd.io/name"]}`;
  // k3s/RKE2 server manifests, EKS add-ons, and kube-addon-manager: the distro upgrade replaces them.
  if (l["objectset.rio.cattle.io/hash"] || l["eks.amazonaws.com/component"] || l["addonmanager.kubernetes.io/mode"]) return "distro-addon";
  if (a["meta.helm.sh/release-name"]) return `helm:${a["meta.helm.sh/release-namespace"]}/${a["meta.helm.sh/release-name"]}`;
  if (l["app.kubernetes.io/managed-by"]) return `managed-by:${l["app.kubernetes.io/managed-by"]}`;
  return "unknown";
}

// workloads: Deployment/DaemonSet/StatefulSet objects -> components keyed by name.
export function inventory(workloads) {
  const found = new Map(), unmapped = [];
  for (const w of workloads) {
    const ns = w.metadata.namespace;
    for (const c of [...(w.spec.template.spec.initContainers ?? []), ...w.spec.template.spec.containers]) {
      const comp = matchComponent(c.image);
      const { repo, tag } = splitImage(c.image);
      const ref = `${w.kind}/${ns}/${w.metadata.name}`;
      if (!comp) {
        if (SYSTEM_NS.test(ns) && tag) unmapped.push({ image: repo, tag, workload: ref });
        continue;
      }
      const key = comp.bundledWith ?? comp.name;
      const version = tag?.replace(/^(distroless|alpine)-/, "") ?? null;
      if (!found.has(key)) found.set(key, { ...(comp.bundledWith ? COMPONENTS.find((x) => x.name === comp.bundledWith) : comp), versions: new Set(), workloads: new Set(), owners: new Set(), images: new Set(), mirrored: false });
      const e = found.get(key);
      // A bundled image (hubble with cilium) has its own version line: it counts as a workload only.
      if (version && parseVersion(version) && !comp.bundledWith) e.versions.add(version);
      e.workloads.add(ref);
      e.owners.add(ownerOf(w));
      e.images.add(repo);
      if (/rancher\/mirrored-/.test(repo)) e.mirrored = true;
    }
  }
  return {
    components: [...found.values()].map((e) => ({ ...e, versions: [...e.versions], workloads: [...e.workloads], owners: [...e.owners], images: [...e.images] })),
    unmapped: [...new Map(unmapped.map((u) => [`${u.image}:${u.tag}`, u])).values()],
  };
}

# Subagent briefs

Fill in the `<placeholders>`. Every brief ends with the exact return format; ask for nothing else, so the reply stays short. Cluster facts for `<cluster facts>`: distro, control-plane count, kubelet, container runtime, OS, kernel, CNI, and the GitOps tool, all from the scan.

## Kubernetes notes (Haiku)

```
Read the Kubernetes upgrade notes for one minor version and list what this cluster must change.
Read only the files listed; do not search the web.

Step: <from> -> <to>
Cluster: <cluster facts>
Files:
- <notes kubernetes-<minor> path>
- <distro notes path, if any>

Return:
### <to>
Must change:
- one line per item that affects this cluster: removed API, flag, feature gate, default, runtime or OS
  requirement. Name the concrete thing (example: "kubelet --pod-infra-container-image removed",
  "cgroup v1 nodes no longer supported", "containerd 1.7 required"); "none" if there is none
Watch:
- at most 5 behavior changes worth checking after the step
Distro:
- one line per distro-specific change (bundled component versions, config keys); "none" if there is none
```

## Component notes (Haiku)

```
Summarize release notes for cluster add-on upgrades and find which Kubernetes versions each target supports.
Read the files listed. For the supported Kubernetes range, use the notes; when they do not say, fetch the
component's official compatibility page (from its docs site or the README in its GitHub repo) with WebFetch.
Do not search the web otherwise.

Kubernetes path: <current minor> -> <each step minor>
Components:
- <name> <from> -> <to> (repo <owner/repo>): <notes file path>
...

Per component return:
### <name> <from> -> <to>
- at most 3 bullets: what changes for an operator
Breaking:
- one line per breaking change: removed value, CRD version, flag, default (example: "CRD v1alpha1 removed,
  migrate Certificates to v1", "values key controller.replicas renamed"); "none" if there is none
Kubernetes: <from> supports <range> | <to> supports <range> | unknown (source: <file or URL>)
Upgrade order: before-control-plane | after-control-plane | any — before when <from> does not support the
next step minor, after when <to> needs a newer minor than the current one
```

## CVE analyst (Sonnet)

```
Assess whether these vulnerabilities can be exploited in this Kubernetes cluster. Change nothing:
run only read-only commands (kubectl --context <ctx> get/describe, kubectl auth can-i).

Cluster: <cluster facts>
Vulnerabilities (from report.json):
- <id> <severity> <component> <version> fixed <version>: <summary>
  advisory: <url>
...

Per vulnerability: read the advisory, name the preconditions (feature, OS, flag, permission), and check
whether this cluster meets them (example: Windows nodes, a feature gate, who can create pods/exec, an
exposed service).

Return per vulnerability:
<id>: exploitable | unlikely | not-reachable
  vector: <one sentence: precondition -> impact, or which precondition is missing>
  evidence: <command and the line of output that decides it>
```

## Locator (Haiku)

```
Find where this GitOps repo declares the version of each cluster component. Search only; change nothing.

Components:
- <name> <current version> (images: <image repos>; workloads: <kind/ns/name>; owner: <owner>)
...

Search YAML, Helm values, Chart.yaml, kustomization.yaml, Argo CD Applications (spec.source.targetRevision,
helm.valuesObject), Flux HelmRelease (spec.chart.spec.version), Terraform (*.tf, *.tfvars), and
system-upgrade-controller Plans. Match the version string and the image or chart name together.

Return per component, one line:
<name>: <file>:<line> (<what it is: image tag | chart version | targetRevision | terraform var>) [, more] | not in repo
```

## Removed-API search (Haiku)

```
Find manifests that use Kubernetes APIs removed by <target minor>. Search and render only; change nothing.

Removed APIs (apiVersion kind -> replacement):
- <apiVersion> <kind> -> <replacement>
...

1. grep the repo for each apiVersion (skip .git, node_modules, vendor, .terraform).
2. For each Helm source (Chart.yaml in the repo, or an Argo CD / Flux app with a chart): run
   `helm template <release> <chart> -f <values>` (helm repo add into a temp HELM_CACHE_HOME if needed) and grep
   the output.

Return one line per hit:
<file or app>: <apiVersion> <kind> (rendered from <chart>, if rendered)
or "none".
```

## Migration agent (Sonnet)

```
Migrate these manifests off Kubernetes APIs that <target minor> removes. Change only what the
migration requires.

Hits:
- <file>:<line>: <apiVersion> <kind> -> <replacement>
...

Per hit, change apiVersion and every field the replacement renamed or restructured (check the Kubernetes
Deprecated API Migration Guide). For a chart you do not own, raise the chart version instead when a release
supports the replacement, and say so. Validate each file with `kubectl --context <ctx> apply --dry-run=server -f <file>`
(server dry run changes nothing). Commit as "k8s: migrate <kind> to <replacement>".

Return: the commit SHA, files changed, and anything you could not migrate with the reason.
```

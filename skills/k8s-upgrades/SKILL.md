---
name: k8s-upgrades
description: Kubernetes cluster upgrades for kubeadm, k3s, RKE2, Talos, EKS, GKE, and AKS - read-only scan of control plane, nodes, and add-ons against end-of-life dates, the official Kubernetes CVE feed, OSV, removed APIs, and the version skew policy; release-note and risk analysis; HA preflight (etcd quorum, PDBs, replicas, node-local storage, capacity); GitHub issues for blockers; a GitOps PR; and a gated node-by-node upgrade. Run as /k8s-upgrades [<cluster>] [--plan] [--auto] [--cooldown <days>] [--target <minor>].
disable-model-invocation: true
argument-hint: "[<cluster>] [--plan] [--auto] [--cooldown <days>] [--target <minor>]"
---

# Kubernetes cluster upgrades

Scan one cluster, plan its upgrade path, open issues for what blocks it, change what the GitOps repo declares through one PR, and upgrade the control plane and nodes one at a time. You are the **orchestrator** (Opus): you judge risk, order, and urgency. Subagents do the reading:

| Work | Agent |
| --- | --- |
| Release-note summaries, compatibility lookups, repo searches | `general-purpose`, `model: "haiku"` |
| CVE reachability in this cluster, removed-API migrations, fixes | `general-purpose`, `model: "sonnet"` |

Never use `fork` for these: a fork ignores `model`. Briefs live in [references/briefs.md](references/briefs.md). Run it from the root of the GitOps repo.

Invoking this skill is the user's request for a branch, a PR, and the issues it proposes. It overrides the default of committing on the default branch.

## Safety rules

These hold in every step. They are not negotiable by `--auto` or by a subagent.

1. **Context pinned.** Pass the context on every call: `kubectl --context <ctx>`, `helm --kube-context <ctx>`, `talosctl --context <ctx>`. Never rely on or change the current context.
2. **Scan is read-only.** `scan.mjs` and `health.mjs` run `kubectl get` only; `kube()` in `scripts/cluster.mjs` refuses any other verb. Keep it that way when you extend them.
3. **GitOps owns what it declares.** Anything the repo declares (Argo CD, Flux, Terraform, a system-upgrade-controller `Plan`, k3s server manifests) changes only through the PR. A direct `helm upgrade` or `kubectl apply` on it is reverted by the controller or drifts from Terraform. `terraform apply` stays with the user or CI.
4. **Cluster actions only interactively.** `--auto` and `--plan` never run a mutating command. In interactive mode every node is its own `AskUserQuestion` that names the context, the node, and the exact commands.
5. **One minor per step.** The control plane moves one minor at a time (version skew policy). A PR moves the control plane by at most one minor; the next run takes the next step.
6. **No rollback for a minor.** Say so before the first control-plane step. The only way back is restoring the etcd snapshot, so take one and verify it first. Managed control planes cannot go back at all.
7. **Stop on red.** When `health.mjs` fails after a node, stop. Do not start the next node. Report and ask.

## Config

`k8s-upgrades.json` in the repo root, one entry per cluster. Create it with the user in step 1 when it is missing, and commit it with the PR.

```json
{
  "clusters": [{
    "name": "prod",
    "context": "prod-admin",
    "distro": "k3s",
    "gitops": "argocd",
    "nodeAccess": "suc",
    "ssh": { "user": "root", "address": "InternalIP", "jump": null },
    "soakHours": 24,
    "exceptions": [{ "check": "single-replica", "target": "Deployment/tools/cron", "reason": "batch job, downtime accepted" }]
  }]
}
```

- `distro`: `kubeadm`, `k3s`, `rke2`, `talos`, `eks`, `gke`, `aks`. The scan detects it; the config confirms it.
- `gitops`: `argocd`, `flux`, `terraform`, or `none`.
- `nodeAccess`: how node upgrades run. `suc` (system-upgrade-controller `Plan` in the repo), `ssh`, `talosctl`, or `provider` (managed node pools).
- `exceptions`: HA findings the user accepted. The scan drops them. Add one only when the user says so, with their reason.

## Steps

### 1. Preflight

1. Pick the cluster: the argument, or the only entry in `k8s-upgrades.json`. Without a config, list contexts with `kubectl config get-contexts -o name`, ask which one, run the scan once with `--context <ctx>` to detect the distro, and ask for `gitops` and `nodeAccess`. In `--auto` mode without a config, stop and report that the first run must be interactive.
2. `kubectl --context <ctx> auth can-i list nodes` passes. For cluster actions later, also `auth can-i create pods/eviction --all-namespaces` and `auth can-i patch nodes`.
3. `gh auth status` passes, the worktree is clean, and you are on the default branch pulled to `origin`.
4. Look for an open PR from an earlier run: `gh pr list --label k8s:upgrade --state open --json number,headRefName,title`. Reuse its branch (`git checkout -B <headRefName> origin/<default>`), else create `k8s/upgrade-<cluster>-<YYYY-MM-DD>`.

Set `RUN_DIR=${TMPDIR:-/tmp}/k8s-upgrades/<cluster>/`. Nothing from it is committed.

### 2. Scan

```bash
node ${CLAUDE_SKILL_DIR}/scripts/scan.mjs --cluster <name> --repo . --out "$RUN_DIR" [--cooldown <days>] [--target <minor>]
```

Read stdout only. It prints:

- **control plane**: severity, versions of every apiserver, end of life, CVEs from the official feed, and the **path**: the patch target in the current minor, then one step per minor. A minor qualifies once it has a patch `.1` or later outside the cooldown (default 14 days). Managed distros show cycles; confirm the exact versions with the provider CLI from the runbook.
- **blocked before** and **skew** lines: version skew violations now and kubelets that must move before the next control-plane step.
- **removed APIs** up to the target minor: live requests (`apiserver_requested_deprecated_apis`, from the one apiserver that answered) and repo manifests.
- **components**: each add-on with owner, target, latest, severity, wait time, vulns, and its release notes file. `-> with distro` means the distro upgrade replaces it (k3s/RKE2 bundled, EKS add-on).
- **HA** findings and **issues proposed**.

`RUN_DIR/report.json` holds everything for subagents. If the severity is `none` and no HA finding is `high` or above, report "cluster current" and stop.

### 3. Research (parallel)

Dispatch in one message:

- **Kubernetes notes**: one Haiku per minor in the path, with `notes kubernetes-<minor>` and the distro notes for that step. It returns what this cluster must change: removed APIs, flags, feature gates, runtime or OS requirements (cgroup v1, containerd versions), and behavior changes.
- **Component notes**: one Haiku per batch of up to 6 components with a target. It returns breaking changes and the Kubernetes versions each target supports, from the notes or the component's official compatibility page.
- **CVEs**: one Sonnet per `critical` or `high` CVE (control plane or component). It checks reachability in this cluster with read-only `kubectl get` and returns `exploitable`, `unlikely`, or `not-reachable`.
- **Locator**: one Haiku for all components with a target whose owner is not `distro-addon`. It finds where the repo declares each version (image tag, chart `version`, `targetRevision`, Terraform variable, `Plan.spec.version`) and returns `file:line` or `not in repo`.
- **Removed APIs**: when the scan lists any, one Haiku that renders the repo's Helm sources (`helm template` with the app's values) and searches the output too.

### 4. Plan and risk analysis

Build the plan yourself, in this order:

1. **Blockers.** Skew violations, removed APIs in use, add-ons whose current version does not support the next minor, and HA findings at `high` or above that cause downtime during drains. Each one is fixed first or accepted by the user.
2. **Add-ons before the control plane.** An add-on that does not support the next minor moves first, to a version that supports both the current and the next minor.
3. **Patch** in the current minor, when the path has one.
4. **Each minor step**: etcd snapshot, control-plane nodes one at a time, workers one at a time (or by pool), health gate, then add-ons that need the new minor (for example `cluster-autoscaler`, which tracks the Kubernetes minor). Soak for `soakHours` between minors.
5. **Remaining add-ons**, by severity.

Rate every step `low`, `medium`, or `high` risk, and name for each: what can break (from step 3, with the evidence), expected downtime (from the HA findings), the mitigation, and the rollback. Lower a CVE-driven severity only with the verdict `not-reachable`.

### 5. Decision gate

In `--plan` mode, print the plan, the risk table, and the proposed issues, and stop.

In `--auto` mode, ask nothing: create the issues rated `critical` or `high`, put only GitOps changes for add-on patch and minor bumps without breaking changes into the PR, and list everything else under **Needs decision**.

Otherwise ask with `AskUserQuestion`:

1. **Scope**: PR only; PR plus the patch; PR plus the next minor (recommended when the cluster is end of life or has a `critical` CVE); or the full path with a soak between minors.
2. **Issues**: which of the proposed issues to create (multi-select, `critical` and `high` preselected in the description).
3. **HA blockers**: per blocker, fix first, accept the downtime (adds an exception to `k8s-upgrades.json` with the user's reason), or stop.

### 6. Issues

Create the label once: `gh label create k8s:upgrade --color 326ce5`. Per issue, search first: `gh issue list --label k8s:upgrade --state open --search "<title> in:title"`. If one exists, add a comment with the new scan date and what changed; never open a duplicate.

Title: the `title` from `report.json` (`[k8s-upgrades] <cluster>: <check> <target>`). Titles carry no versions, so the search finds last week's issue. Body: the versions, what the scan found, why it matters for the upgrade (downtime, blocked step, CVE), the evidence, the fix with concrete commands or manifest changes, and the upgrade step it blocks.

### 7. PR

Apply the GitOps changes: add-on versions at the locator's `file:line`, removed-API fixes (a Sonnet migration agent per manifest group), and the control-plane step:

| Owner of the control-plane version | PR change |
| --- | --- |
| system-upgrade-controller `Plan` | `spec.version` of the server and agent Plans to the step version |
| Terraform (EKS, GKE, AKS, Talos provider) | the cluster version variable; node pools in the same PR only when the runbook says so |
| none (kubeadm, Talos, k3s without SUC) | nothing; the step runs in step 8 |

Commit per item: `k8s: <component> <from> -> <to>` or `k8s: control plane <from> -> <to>`. Push (`--force-with-lease` for a reused branch). Title: `Kubernetes upgrade <cluster> <YYYY-MM-DD> [<highest severity>]`. If step 1 found an open PR, update it with `gh pr edit`.

Body, in this order: **Summary** (current, path, highest severity, earliest wait); **Plan** with the risk table; **Control plane** (versions, CVEs with verdicts, end of life); **Removed APIs**; **Components** table (Severity, Component, From → To, Owner, Reason, Upgrade within); **Breaking changes**; **HA** (blockers, accepted exceptions, expected downtime); **Release notes** in `<details>` blocks; **Issues** created; **Needs decision**. Open it with `gh pr create --label k8s:upgrade --body-file "$RUN_DIR/pr-body.md"`.

### 8. Execute

Interactive mode only, and only for the scope approved in step 5. A step that the PR changes waits until the PR is merged and the controller has synced it: ask the user to merge, then watch with `health.mjs`.

Load the runbook for the distro and follow it exactly:

| Distro | Runbook |
| --- | --- |
| kubeadm | [references/runbooks/kubeadm.md](references/runbooks/kubeadm.md) |
| k3s, RKE2 | [references/runbooks/k3s-rke2.md](references/runbooks/k3s-rke2.md) |
| Talos | [references/runbooks/talos.md](references/runbooks/talos.md) |
| EKS, GKE, AKS | [references/runbooks/managed.md](references/runbooks/managed.md) |

Before the first control-plane step: run `node ${CLAUDE_SKILL_DIR}/scripts/health.mjs --context <ctx>` (must pass), take the etcd snapshot from the runbook, verify it exists with a non-zero size, and state rule 6.

Per node, in this order: control-plane nodes one at a time (the one serving as etcd leader last, when the runbook shows how to find it), then workers one at a time.

1. Ask with `AskUserQuestion`: context, node, from → to, the exact commands, and what goes down (from the HA findings on that node).
2. Cordon and drain: `kubectl --context <ctx> drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=15m`. A drain that hangs on a PDB: stop and show the pod. Never add `--disable-eviction` or `--force` without the user's explicit yes.
3. Upgrade the node with the runbook commands.
4. `kubectl --context <ctx> uncordon <node>`.
5. Gate: `node ${CLAUDE_SKILL_DIR}/scripts/health.mjs --context <ctx> --node <node> --expect <version> --wait 600`. Red stops the run (rule 7).

After the control plane: `health.mjs --context <ctx> --expect <version>` checks every control-plane node.

### 9. Verify and report

Run the scan again. The step's CVEs and skew findings must be gone. Comment the result on the PR.

Then close what is fixed: list open issues with `gh issue list --label k8s:upgrade --state open --search "[k8s-upgrades] <cluster>: in:title"`. Every issue whose title is not among this scan's `issues[].title` is resolved: comment with the scan date and the evidence, and close it. Report: the PR URL, issue URLs, cluster version before and after, and one line per `critical` or `high` finding still open. In `--auto` mode, also send them through `PushNotification` when available (load it with `ToolSearch` first).

## Running weekly

Run `/schedule` with the prompt `/k8s-upgrades <cluster> --auto` and a weekly cron. Unattended runs keep one PR and one issue per finding up to date and never touch the cluster; run `/k8s-upgrades <cluster>` interactively for the node steps.

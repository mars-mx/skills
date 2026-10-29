# Talos

Talos upgrades two things separately: Talos itself (`talosctl upgrade`, one node at a time, with a reboot) and Kubernetes (`talosctl upgrade-k8s`, which rolls the control-plane static pods and kubelets across all nodes). Each Talos version supports a range of Kubernetes versions: check the Talos support matrix for the step and upgrade Talos first when the target Kubernetes minor is outside its range.

Confirm every command with `talosctl <command> --help` for the installed `talosctl` version before running it. Use `talosctl --context <talos-ctx>` on every call; the Talos context is separate from the kubectl context.

## Before the first step

1. Read the Kubernetes notes for the step.
2. etcd snapshot from one control-plane node:

   ```bash
   talosctl --context <talos-ctx> -n <cp-ip> etcd snapshot pre-<version>.snapshot
   ```

   The file is written on the workstation. Verify it exists with a non-zero size.
3. `talosctl --context <talos-ctx> -n <cp-ip> etcd members` lists every control-plane node, and `health.mjs` passes.

## Talos itself (when the support matrix requires it)

One node at a time, control plane first. Use the installer image the nodes already use (a factory image with extensions keeps its schematic ID; read it from `talosctl get machineconfig` or the repo's machine config):

```bash
talosctl --context <talos-ctx> upgrade --nodes <ip> --image <installer image>:<talos version> --wait
```

`talosctl upgrade` cordons and drains the node itself. Run the gate from the main procedure after each node. When the repo manages machine configs (Terraform `siderolabs/talos` provider, Omni, or patches in git), change the installer version there through the PR instead.

## Kubernetes

Dry run first and show its output to the user:

```bash
talosctl --context <talos-ctx> --nodes <cp-ip> upgrade-k8s --to <version> --dry-run
talosctl --context <talos-ctx> --nodes <cp-ip> upgrade-k8s --to <version>
```

`upgrade-k8s` handles the order (control-plane components node by node, then kubelets) and the bootstrap manifests. It does not drain: it restarts each kubelet in place. The upstream skew policy does not support an in-place minor kubelet upgrade without a drain, so say so in the plan; for nodes with workloads that cannot take a kubelet restart (HA findings), cordon and drain them before `upgrade-k8s` and uncordon after. Run `health.mjs --context <ctx> --expect <version> --wait 900` after it finishes.

## Rollback

Talos itself: `talosctl --context <talos-ctx> rollback --nodes <ip>` boots the previous Talos image. Kubernetes after a minor step: only an etcd restore (`talosctl bootstrap --recover-from=<snapshot>` on one control-plane node of a wiped control plane), which is disaster recovery and loses every change since the snapshot.

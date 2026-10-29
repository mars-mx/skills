# k3s and RKE2

`<bin>` is `k3s` or `rke2`. The apiserver, controller manager, scheduler, kubelet, containerd, CoreDNS, metrics-server, and local-path-provisioner all ship in the distro binary: upgrading a node upgrades all of them. Bundled add-ons (`-> with distro` in the scan) move with the server nodes.

Versions look like `v1.34.12+k3s1` or `v1.34.12+rke2r1`. Use the exact version from the scan path.

## Before the first control-plane step

1. Read the k3s/RKE2 notes for the step from the scan (`notes k3s-<version>`): bundled component versions, removed flags, and config keys.
2. etcd snapshot (embedded etcd; skip for an external datastore and back up that instead), on one server node:

   ```bash
   sudo <bin> etcd-snapshot save --name pre-<version>
   ```

   Verify: `kubectl --context <ctx> get etcdsnapshotfiles` lists `pre-<version>-<node>-<ts>` with a non-zero size. With S3 snapshots configured, the file is also in the bucket.
3. Etcd quorum: the scan shows no `etcd-quorum` finding, and `health.mjs` passes (its `/readyz` includes etcd).

## With system-upgrade-controller (`nodeAccess: suc`)

The upgrade is the PR: the server and agent `Plan` objects in the repo get `spec.version: <version>` (remove `spec.channel` if set, so the version is pinned). The controller upgrades nodes itself.

Check the Plans before the PR:

- Server Plan: `concurrency: 1`, `cordon: true`, `nodeSelector` on `node-role.kubernetes.io/control-plane In ["true"]`, image `rancher/k3s-upgrade` (or `rancher/rke2-upgrade`).
- Agent Plan: `concurrency: 1`, `prepare` with `args: [prepare, <server plan name>]` so agents wait for the servers, `nodeSelector` on `node-role.kubernetes.io/control-plane DoesNotExist`. Add `drain: { force: false, ignoreDaemonSets: true, deleteEmptydirData: true, timeout: 900s }` when the HA findings show workloads that must move before the node restarts; without `drain`, `cordon: true` only stops new pods.
- No `window` that blocks the planned time.

If the repo has no Plans and the controller is not installed, propose installing it in the PR (manifest from the `rancher/system-upgrade-controller` release matching the scan's target) and run this step manually instead.

After the merge and the Argo CD or Flux sync, watch instead of acting:

```bash
kubectl --context <ctx> -n system-upgrade get plans,jobs -o wide
node ${CLAUDE_SKILL_DIR}/scripts/health.mjs --context <ctx> --expect <version> --wait 1800
```

A job in `BackoffLimitExceeded` or a node stuck `SchedulingDisabled` is red: stop, show `kubectl --context <ctx> -n system-upgrade logs job/<job>`, and ask.

## Manual (`nodeAccess: ssh`)

Per node, after the drain from the main procedure. Server nodes first, one at a time, then agents.

The install script regenerates the systemd unit and its env file from what you pass now: install-script variables (`INSTALL_K3S_EXEC`, `K3S_*`) and arguments that you do not pass again are lost, and the node may fail to rejoin. Only `/etc/rancher/<bin>/config.yaml` survives untouched. So read the current setup first and pass it back:

```bash
ssh <user>@<address> 'systemctl cat k3s 2>/dev/null || systemctl cat k3s-agent; sudo cat /etc/systemd/system/k3s*.env'
```

`<EXISTING_ENV>` are the variables from the env file (`K3S_URL`, `K3S_TOKEN`, ...) and `<EXISTING_ARGS>` the arguments after `k3s` in `ExecStart` (`server --cluster-init ...` or `agent ...`). Show both to the user in the node question. Prefer moving them into `config.yaml` in a separate change; do not do it during the upgrade.

k3s (server or agent):

```bash
ssh <user>@<address> 'curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION=<version> <EXISTING_ENV> sh -s - <EXISTING_ARGS>'
```

RKE2 keeps its settings in `/etc/rancher/rke2/config.yaml`; the install script only replaces the binaries. Server, then agent:

```bash
ssh <user>@<address> 'curl -sfL https://get.rke2.io | sudo INSTALL_RKE2_VERSION=<version> sh - && sudo systemctl restart rke2-server'
ssh <user>@<address> 'curl -sfL https://get.rke2.io | sudo INSTALL_RKE2_VERSION=<version> INSTALL_RKE2_TYPE=agent sh - && sudo systemctl restart rke2-agent'
```

Then uncordon and run the gate from the main procedure.

## Rollback

A patch inside the same minor: reinstall the previous version the same way. A minor: restore the snapshot (`<bin> server --cluster-reset --cluster-reset-restore-path=<snapshot>` on one server with all servers stopped, then rejoin the others). Treat this as disaster recovery; it loses every change since the snapshot.

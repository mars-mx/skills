# kubeadm

Packages come from `pkgs.k8s.io`, one repository per minor. Every minor step changes the repository on every node first. Commands assume Debian or Ubuntu (`apt`); on RHEL-family nodes use `dnf` with `--disableexcludes=kubernetes` and the `.rpm` repository.

`<version>` is the exact target (for example `1.34.12`); `<minor>` is `v1.34`.

## Before the first control-plane step

1. Read the Kubernetes notes for the step.
2. etcd snapshot (stacked etcd), from the workstation:

   ```bash
   kubectl --context <ctx> -n kube-system exec etcd-<cp-node> -- etcdctl \
     --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt \
     --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key \
     snapshot save /var/lib/etcd/pre-<version>.db
   ```

   The file lands in the etcd data directory on `<cp-node>`. Verify with `ssh <user>@<address> sudo ls -l /var/lib/etcd/pre-<version>.db` (non-zero size) and copy it off the node. External etcd: snapshot on an etcd member with its own certificates.
3. Find the etcd leader, so it upgrades last:

   ```bash
   kubectl --context <ctx> -n kube-system exec etcd-<cp-node> -- etcdctl <same TLS flags> endpoint status --cluster -w table
   ```

## Every node: package repository

```bash
ssh <user>@<address> "sudo sed -i 's#/core:/stable:/v[0-9.]*/#/core:/stable:/<minor>/#' /etc/apt/sources.list.d/kubernetes.list && sudo apt-get update"
```

Check `apt-cache madison kubeadm | grep <version>` before going on.

## First control-plane node

```bash
ssh <user>@<address> "sudo apt-mark unhold kubeadm && sudo apt-get install -y kubeadm='<version>-*' && sudo apt-mark hold kubeadm"
ssh <user>@<address> "sudo kubeadm upgrade plan"
ssh <user>@<address> "sudo kubeadm upgrade apply v<version> --yes"
```

Show the `upgrade plan` output to the user before `apply`: it lists component versions and manual steps (for example a CoreDNS config or kube-proxy config change). `kubeadm upgrade apply` also upgrades CoreDNS and kube-proxy and renews certificates.

## Other control-plane nodes, one at a time

```bash
ssh <user>@<address> "sudo apt-mark unhold kubeadm && sudo apt-get install -y kubeadm='<version>-*' && sudo apt-mark hold kubeadm && sudo kubeadm upgrade node"
```

## kubelet on every node (control plane first, then workers), after the drain

```bash
ssh <user>@<address> "sudo apt-mark unhold kubelet kubectl && sudo apt-get install -y kubelet='<version>-*' kubectl='<version>-*' && sudo apt-mark hold kubelet kubectl && sudo systemctl daemon-reload && sudo systemctl restart kubelet"
```

Workers run `sudo kubeadm upgrade node` (after installing the new `kubeadm`) before the kubelet step.

Then uncordon and run the gate from the main procedure.

## Load balancer

With several control-plane nodes behind a load balancer or a VIP (kube-vip, keepalived, HAProxy), the health check must target `/readyz` on port 6443. A TCP-only check sends traffic to an apiserver that is restarting. Confirm the check before the first node; say so in the plan when you cannot.

## Rollback

`kubeadm upgrade apply` keeps the previous static pod manifests and an etcd backup in `/etc/kubernetes/tmp/`. A failed apply on the first node rolls itself back. After a completed minor step the only way back is restoring the etcd snapshot on every member and reinstalling the previous packages: disaster recovery that loses every change since the snapshot.

# EKS, GKE, and AKS

The provider runs the control plane and etcd: there is no snapshot and no way back after a control-plane upgrade. The provider decides which versions exist; the scan's path comes from endoflife.date cycles, so confirm the exact version with the provider CLI before planning.

Confirm every command with `--help` for the installed CLI before running it. When Terraform (or Pulumi, or Crossplane) declares the cluster version or node pool versions, the change is the PR; `terraform apply` stays with the user or CI. Run the CLI commands below only for clusters the repo does not manage.

Upgrade order per minor: control plane, then provider add-ons, then node pools one at a time.

## EKS

Versions and readiness:

```bash
aws eks describe-cluster --name <cluster> --query 'cluster.version'
aws eks list-insights --cluster-name <cluster> --filter 'categories=UPGRADE_READINESS'
aws eks describe-addon-versions --kubernetes-version <minor> --addon-name <addon>
```

Upgrade insights flag removed API use and node skew; resolve every `ERROR` insight before the step. Extended support costs extra per cluster hour: mention it when the scan shows the cycle is in extended support.

```bash
aws eks update-cluster-version --name <cluster> --kubernetes-version <minor>
aws eks wait cluster-active --name <cluster>
aws eks update-addon --cluster-name <cluster> --addon-name <addon> --addon-version <version> --resolve-conflicts PRESERVE
aws eks update-nodegroup-version --cluster-name <cluster> --nodegroup-name <group> --kubernetes-version <minor>
```

Managed node groups drain and replace nodes themselves, respecting PDBs (a PDB that allows no disruption fails the update after its timeout). Karpenter nodes move through drift when the node class AMI selector follows the cluster version. Self-managed groups follow the main node procedure.

## GKE

Versions and channel:

```bash
gcloud container get-server-config --location <location> --format='yaml(channels)'
gcloud container clusters describe <cluster> --location <location> --format='value(releaseChannel.channel,currentMasterVersion,maintenancePolicy)'
```

A cluster on a release channel auto-upgrades inside its maintenance windows; a manual upgrade must pick a version the channel offers. Check deprecation insights in the console (Kubernetes Engine, Clusters, the cluster, Notifications) or with `gcloud recommender insights list` for the `google.container.DiagnosisInsight` type when the CLI supports it.

```bash
gcloud container clusters upgrade <cluster> --location <location> --master --cluster-version <version>
gcloud container clusters upgrade <cluster> --location <location> --node-pool <pool> --cluster-version <version>
```

Node pools use surge upgrades by default (`maxSurge`, `maxUnavailable` on the pool); set a surge of at least 1 when the scan shows `drain-capacity`.

## AKS

```bash
az aks get-upgrades --resource-group <rg> --name <cluster> --output table
az aks upgrade --resource-group <rg> --name <cluster> --kubernetes-version <version> --control-plane-only --yes
az aks nodepool upgrade --resource-group <rg> --cluster-name <cluster> --name <pool> --kubernetes-version <version> --yes
```

Node pools drain through surge nodes (`--max-surge`, default 10 percent on new pools); a PDB that allows no disruption blocks the drain until its timeout. Check `az aks show --query autoUpgradeProfile` first: an auto-upgrade channel may already plan the same step.

## Gate

After the control plane: `health.mjs --context <ctx>` and the provider's own status (`aws eks describe-update`, `gcloud container operations list`, `az aks show --query provisioningState`). After each node pool: `health.mjs --context <ctx> --wait 1800`.

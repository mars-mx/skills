---
name: dep-upgrades
description: Weekly dependency check for npm and Python - CVEs and CWEs from OSV, upgrade targets with a supply-chain cooldown, release-note diffs, severity with a wait time, breaking-change analysis in the codebase, and an "Automated package upgrades" PR. Run as /dep-upgrades [--auto] [--cooldown <days>].
disable-model-invocation: true
argument-hint: "[--auto] [--cooldown <days>]"
---

# Dependency upgrades

Find every npm and Python manifest in the repo, decide which packages to upgrade and how urgently, apply the safe upgrades, and open one PR. You are the **orchestrator** (Opus): you judge severity, breaking changes, and grouping. Subagents do the reading:

| Work | Agent |
| --- | --- |
| Release-note summaries, codebase search for a breaking change | `general-purpose`, `model: "haiku"` |
| Attack-vector analysis per vulnerable package, code migrations, fixes | `general-purpose`, `model: "sonnet"` |

Never use `fork` for these: a fork ignores `model`. Briefs live in [references/briefs.md](references/briefs.md).

Invoking this skill is the user's request for a branch and a PR. It overrides the default of committing on the default branch.

## Policy

- **Data comes from the script, never from web search.** `scripts/scan.mjs` queries the npm registry, PyPI, OSV (CVEs, CWEs, fixed versions, malware), and GitHub release notes or `CHANGELOG` files. If you miss data, extend the script.
- **Cooldown.** The target is the newest stable release that is at least `--cooldown` days old (default 14). This keeps the repo one or two releases behind and out of reach of a freshly hijacked release. A security fix beats the cooldown: the target is then at least the highest fixed version, marked `fresh`.
- **Pinning.** Every upgraded package is pinned exactly (`npm install --save-exact`, `name==version`). Ranges you do not touch stay as they are and are listed under supply chain in the PR.
- **Severity** and the wait time per level:

  | Severity | Trigger (any) | Upgrade within |
  | --- | --- | --- |
  | `critical` | malicious package (OSV `MAL-`), critical vuln | 24 hours |
  | `high` | high vuln, current version deprecated or yanked, 3+ majors behind, 2+ years behind latest | 7 days |
  | `medium` | medium or unrated vuln, 1-2 majors behind, 1+ year behind | 30 days |
  | `low` | anything else outdated | next cycle (90 days) |

  The script sets the level from the data. You may lower a vuln-driven level only with the attack-vector verdict `not-reachable`, and never for a malicious package.
- **Breaking.** A package is breaking when the bump is major (including `0.x` minor) or its release notes name a breaking change. It is **breaking-used** when a Haiku search finds the changed API in this repo.
- **Modes.** Interactive by default. `--auto` is for unattended runs (`/schedule`, `/loop`): ask nothing, leave breaking-used packages out of the PR and list them under **Needs decision**.

## Steps

### 1. Preflight

1. `gh auth status` passes, the worktree is clean, and you are on the default branch pulled to `origin`.
2. Look for an open PR from an earlier run: `gh pr list --label deps:automated --state open --json number,headRefName`. If there is one, check out its branch and merge the default branch into it; this run updates that PR. Otherwise create `deps/upgrades-<YYYY-MM-DD>`.

Set `RUN_DIR=${TMPDIR:-/tmp}/dep-upgrades/<repo>/`. Nothing from it is committed.

### 2. Scan

```bash
node ${CLAUDE_SKILL_DIR}/scripts/scan.mjs . --out "$RUN_DIR" [--cooldown <days>]
```

Read stdout only. It lists each package with severity, `current -> target`, `in-major` (newest cooled release in the current major), latest, bump, releases and days behind, the wait time, up to 5 vulns (ID, CVE, severity, CWE, fixed version), breaking signals, and the path to its release notes. `transitive:` lists vulnerable locked packages that are not direct dependencies. `RUN_DIR/report.json` holds the full data for subagents.

If no package has a severity and no supply-chain line appears, report "all current" and stop. No PR.

### 3. Research (parallel)

Dispatch in one message:

- **Release notes**: one Haiku summarizer per batch of up to 8 packages that have a `notes` file. It returns per package 3 bullets at most and the list of breaking changes, each one a concrete API (`removed res.sendfile()`), not a heading.
- **Vulnerabilities**: one Sonnet analyst per package (direct or transitive) with a `critical` or `high` vuln. It returns per vuln a verdict (`exploitable`, `unlikely`, `not-reachable`), the attack vector in this project, and the evidence (file and line). `medium` and `low` vulns get no agent; the upgrade fixes them.

### 4. Breaking-change search

For each breaking change from step 3, and for each major bump without notes (search for the package's imports and its most used APIs), dispatch a Haiku searcher. Batch the changes of one package into one searcher when there are more than 8. Each returns `used` with file and line, or `unused`.

Then decide per package, yourself:

- **upgrade** to `target`: no breaking change, or breaking-unused.
- **upgrade in-major** to `in-major`: breaking-used, and `in-major` fixes every vuln (or there is none). The major upgrade goes to step 5.
- **breaking-used**: needs code changes. Goes to step 5.
- **hold**: no cooled target, or you have a recorded reason.

### 5. Breaking gate

Skip this step when no package is breaking-used.

In `--auto` mode: ask nothing. Breaking-used packages stay out; step 8 lists them under **Needs decision**.

Otherwise ask with `AskUserQuestion`, listing per package the version jump, the severity, and where the changed API is used:

1. **PR split**: one PR per breaking package first, then the rest together (recommended when more than one breaking package or any is `high` or above); everything in one PR; or leave the breaking packages out.
2. **Migration**: start a Sonnet migration agent per breaking package that implements only the breaking changes in this repo, or leave the code changes to the user.

For per-package PRs, run steps 6 to 8 per breaking package on its own branch `deps/<package>-<version>` from the default branch, then once for the rest.

### 6. Apply

Run the `command` from `report.json` for each package (or `commandInMajor` for in-major). For Python projects without `uv`, `poetry`, or `pdm`, edit the requirement line to `name==version`; if a `requirements.in` exists next to it, edit that file and run `pip-compile` instead. For transitive vulns: `npm update <name>` or `npm audit fix` (never `--force`) for npm, `uv lock --upgrade-package <name>` or `poetry update <name>` for Python. A transitive fix that needs a parent's major bump goes to the parent's decision.

Dispatch migration agents now, if the user chose them. Commit per package: `deps: <name> <from> -> <to>`.

Run the scan again with the same arguments. Every vuln that the upgrades target must be gone.

### 7. Verify

Install, then run the repo's typecheck, lint, tests, and build (from `package.json` scripts, `pyproject.toml`, `Makefile`, or the CI workflow). A failure goes to a Sonnet fixer with the fix brief, at most 3 rounds. Still red: revert that package's commit, mark it **held** with the failure, and continue.

### 8. PR

Push. Create the label once if it is missing: `gh label create deps:automated --color 0366d6`.

Title: `Automated package upgrades <YYYY-MM-DD> [<highest severity>]`. A per-package PR is `Automated package upgrade: <name> <from> -> <to> (breaking)`. If step 1 found an open PR, update its title and body with `gh pr edit` instead.

Body, in this order:

1. **Summary**: highest severity, count per severity, and the earliest wait time.
2. **Upgrades**: table with Severity, Package, From → To, Bump, Reason, Upgrade within.
3. **Vulnerabilities**: per vuln the ID, CVE, CWE, severity, the analyst's verdict and attack vector. Transitive ones are marked.
4. **Breaking changes**: per package what changed, where it was used, and what the migration changed.
5. **Release notes**: the Haiku summaries, each in a `<details>` block.
6. **Held** and **Needs decision**: package, why, and what decision is open.
7. **Supply chain**: lockfiles missing, unpinned ranges, `fresh` targets inside the cooldown.

Open it with `gh pr create --label deps:automated --body-file RUN_DIR/pr-body.md`.

### 9. Report

Send the PR URLs and one line per `critical` or `high` package. In `--auto` mode, also send them through `PushNotification` when it is available (load it with `ToolSearch` first).

## Running weekly

Run `/schedule` with the prompt `/dep-upgrades --auto` and a weekly cron, or `/loop 7d /dep-upgrades --auto` in a long-running session. The open-PR check in step 1 keeps one PR per repo up to date instead of opening a new one each week.

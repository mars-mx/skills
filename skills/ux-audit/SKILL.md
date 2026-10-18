---
name: ux-audit
description: Audit the codebase against the ux-design catalog rules, report violations, and offer fixes.
disable-model-invocation: true
---

# UX audit

Audits the whole codebase against the catalog-first rules, summarizes the violations, and offers to fix them. Haiku subagents do the file-level work; an Opus subagent writes the summary.

Shared files from the `ux-design` skill:

- Rules: `${CLAUDE_SKILL_DIR}/../ux-design/references/rules.md`
- Scripts: `${CLAUDE_SKILL_DIR}/../ux-design/scripts/`

## 1. Preflight

```bash
node ${CLAUDE_SKILL_DIR}/../ux-design/scripts/preflight.mjs
```

On any `FAIL`, stop and handle it as the `ux-design` skill describes (install offer, decision step). The audit needs `ux.config.json`: the motion decision and the catalog paths define what counts as a violation.

## 2. Scan

The **workdir** is `.ux-audit/` in the project root. It holds the temporary report, ignores itself in git, and sits inside the project, so subagents can write to it without permission prompts. Shell variables do not survive between commands: write the path `.ux-audit/` literally in every later command and subagent prompt.

```bash
mkdir -p .ux-audit && echo '*' > .ux-audit/.gitignore
node ${CLAUDE_SKILL_DIR}/../ux-design/scripts/scan.mjs . > .ux-audit/candidates.jsonl
```

List every UI source file (`*.tsx`, `*.jsx` outside `node_modules` and build output) and split them into batches of about 15 files, keeping each directory in one batch where possible. Write each batch to `.ux-audit/batch-<n>.txt`.

## 3. Review (Haiku, parallel)

Spawn one Agent per batch in a single message, with `model: "haiku"`. Each prompt contains: the rules path, the `ux.config.json` path, the batch file, the candidates file, and the output path `.ux-audit/findings-<n>.jsonl`. Instruct each agent:

> Read the rules file and `ux.config.json`. Then read every file in your batch completely. Judge every scanner candidate for your files: confirmed or false positive. Also report violations the scanner cannot see, mainly UX-C1 (a catalog component exists for hand-built UI), UX-C5 (page-local components), and the structural part of UX-C6 (missing Dialog/Sheet/Drawer Title, items outside their Group, incomplete Card); list the catalog folders to know what exists. Skip anything in `exceptions`. Write one JSON object per confirmed violation to your output file:
>
> `{"file", "line", "rule", "severity", "tier", "evidence", "fix"}`
>
> `rule` is a rule ID, `severity` and `tier` come from the rules table (`tier` may be raised if the fix needs it), `evidence` quotes the code, `fix` names the catalog component or variant to use. Report only; do not edit files. You are done when every file was read and every candidate was judged. Reply with the count of confirmed findings.

The step is done when every batch has a findings file.

## 4. Summarize (Opus)

Spawn one Agent with `model: "opus"`. It reads all `findings-*.jsonl`, removes duplicates, and writes `.ux-audit/report.md`:

- totals per rule and per severity
- the findings grouped by tier: **reuse** (auto-fixable), **extend** and **new** (need approval)
- for extend and new: one proposal per missing variant or component, with every place that would use it
- the most-affected files

Show the user the summary and the report path.

## 5. Offer fixes

Ask with AskUserQuestion. Options: fix all reuse-tier findings, pick findings, or report only.

Findings in the extend and new tiers follow the approval rule of `ux-design`: present each proposal and fix only the ones the user approves. An approved deviation that stays in feature code goes into `ux.config.json` → `exceptions`.

## 6. Fix (Haiku, parallel)

Split the approved findings into batches by file, so no two agents touch the same file. Catalog changes (extend, new) go to a single agent that runs first and adds the stories; the feature-code batches run after it. Spawn the agents with `model: "haiku"`, each with the rules path, its findings, and this completion criterion: every assigned finding is fixed or reported back with the reason it could not be fixed.

Then verify:

1. Run the project's typecheck and lint scripts from `package.json`.
2. Rerun the scan on the touched files: `node ${CLAUDE_SKILL_DIR}/../ux-design/scripts/scan.mjs . --files <touched files>`.

Report fixed, skipped, and remaining findings with their counts.

## 7. Clean up

Delete `.ux-audit/` unless the user wants to keep the report.

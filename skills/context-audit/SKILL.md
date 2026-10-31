---
name: context-audit
description: Audit what fills Claude's context window - the measured baseline per session (tool schemas per MCP server, skill listing, CLAUDE.md, hooks), the costliest tool calls of recent sessions with Haiku pattern search, and an aggressive cleanup of auto memory (MEMORY.md). Run as /context-audit [--days <n>] [--all] [--memory-only] [--auto].
disable-model-invocation: true
argument-hint: "[--days <n>] [--all] [--memory-only] [--auto]"
---

# Context audit

Context is the scarcest resource in a session. Every token that loads before the user's first prompt, and every tool result that stays in the history, is re-read on every later request and dilutes attention. Find what fills the context, rank it by measured tokens, fix what the user approves, and clean out auto memory.

You are the **orchestrator** (Opus): you rank findings and decide fixes. Haiku reads the raw tool output:

| Work | Agent |
| --- | --- |
| Pattern search over a batch of costly tool calls | `general-purpose`, `model: "haiku"` |

Never use `fork` for this: a fork ignores `model`. Briefs live in [references/briefs.md](references/briefs.md). The best practices that back each check are in [references/links.md](references/links.md); to confirm a fact, `curl -sL <url>.md | grep -n <term>` instead of loading the whole page.

## Policy

- **Numbers come from the scripts.** They read the transcripts in `~/.claude/projects/`. Never estimate from file sizes when a script measures. If a number is missing, extend the script.
- **Measured beats estimated.** The baseline is the first request's input tokens from `usage`. Parts are byte shares scaled to that total; call them approximate.
- **Rank by carried tokens.** A result of 10K tokens that stays for 200 requests costs 2M tokens of re-reads. Size alone misleads.
- **Fix the source.** Prefer a config change (disable a server, scope a plugin to a project, move a CLAUDE.md section into a skill or path rule, add a filter hook) over a rule the model has to remember.
- **Ask before changing anything.** Every config edit and every memory deletion goes through one approval in step 5. Memory is backed up first.
- **`--auto`** is for unattended runs: ask nothing, change nothing, stop after step 5 with the table as the report.

## Steps

Set `RUN_DIR=${TMPDIR:-/tmp}/context-audit/<YYYY-MM-DD>/`. Nothing in it is committed. With `--memory-only`, run only steps 4 to 6.

### 1. Baseline

```bash
node ${CLAUDE_SKILL_DIR}/scripts/baseline.mjs --days <n> [--project <cwd>]
node ${CLAUDE_SKILL_DIR}/scripts/baseline.mjs --days <n> --all     # with --all
```

Read stdout only. It prints the median baseline per tool shape (tool count, deferred count, entrypoint), the parts of the heaviest shape, and the config that feeds them: CLAUDE.md chain with imports, `.claude/rules`, the memory index, enabled plugins, MCP servers per scope, and SessionStart and UserPromptSubmit hooks.

Judge relatively, not against fixed budgets: the gap between the heaviest and the lightest tool shape is avoidable, and so is every part that only the heavy shape has.

| Part | Check | Typical fix |
| --- | --- | --- |
| `tools mcp:<server>` | 0 at start: MCP tools are deferred by default | `ENABLE_TOOL_SEARCH` set to `auto` or `false` loads them upfront: remove it or set `true`; else disable the server in `/mcp` or move it to the one project that uses it |
| `tools built-in` | same across shapes; a jump means a host (desktop app, extension) adds tools | name the entrypoint that adds them |
| `skill_listing` | one of the largest parts | per-project `enabledPlugins`, uninstall plugins not used in 30 days |
| `instructions` (CLAUDE.md, rules) | a file marked `over 200 lines` (the documented target) | split per path into `.claude/rules/`, move workflows into skills, cut what the code already says |
| `hook SessionStart` | any text injected into every session | load style guides as a skill or output style instead of injecting them |
| memory index | any line that is not a durable fact | step 4 |

Two sessions of one project with very different baselines point to a shape problem: compare their tool counts first.

### 2. Costly tool calls

```bash
node ${CLAUDE_SKILL_DIR}/scripts/toolcalls.mjs --days <n> [--project <cwd>] --out "$RUN_DIR"
```

It prints totals, the tools ranked by carried tokens, the top 20 calls, and files read 3 or more times in one session. It writes `calls.jsonl` and up to 8 batches of the costliest calls, grouped by tool, with result excerpts, to `RUN_DIR/batches/`.

Dispatch one Haiku pattern finder per batch file, all in one message, with the brief from [references/briefs.md](references/briefs.md).

### 3. Rank

Haiku returns ids, not numbers. Get the numbers per pattern from the script:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/toolcalls.mjs --out "$RUN_DIR" --sum <id,id,...>
```

Merge the baseline parts and the Haiku patterns into one list. Per finding: what it is, tokens per session (baseline) or carried tokens per week (tool pattern), evidence (shape, call IDs), and one concrete fix. Merge duplicates across batches. Drop patterns with fewer than 3 occurrences unless one call costs more than 1M carried tokens.

Common fixes for tool patterns:

- whole-file reads of large files: `Grep` first, then `Read` with `offset` and `limit`
- the same file read again and again (specs, plans): keep a short summary, re-read only the changed section
- verbose CLI output (`git diff`, `gh issue view --json`, test runs, `kubectl`): narrow the command, or a PostToolUse hook or wrapper that filters it
- large MCP or browser results: a CLI instead of the server, or a subagent that returns a summary
- exploration in the main thread: delegate to an `Explore` or Haiku subagent so only the conclusion returns

### 4. Auto memory

```bash
node ${CLAUDE_SKILL_DIR}/scripts/memory.mjs list [--project <cwd>] [--all] --json
```

It lists every memory dir with its index size and per file the type, description, size, date, `[[links]]`, and a `temporal` hint, plus orphan files, dangling index lines, broken links, and missing frontmatter. Read each memory file yourself before you classify it. Treat auto memory as guilty until proven useful. Classify every file:

- **delete**: session state and anything temporal: open items, next steps, "morgen weiter", status of a task, dated plans, decisions recorded in an issue, PR, or the repo; facts the code, git history, or CLAUDE.md already holds; a correction of a single mistake; anything that would be wrong once a task is done. When in doubt, delete.
- **move**: a durable rule about how to work in this project (`feedback`, `user`) belongs in the project's `CLAUDE.md` or a `.claude/rules/` file, where it is versioned and reviewed. Propose the exact line; do not move the whole file.
- **merge**: several files that state facets of one durable fact. Write one file: frontmatter `name`, `description` (one line that says when it matters), `metadata.type`, then the fact in at most 5 lines, plus `**Why:**` and `**How to apply:**` for feedback. No narrative, no history, no session IDs.
- **keep**: a durable, non-obvious fact that is in no versioned place and that a future session needs. Expect few.

Also decide on **auto memory itself**. The harness keeps writing new memories in every session, so cleanup alone does not hold. Recommend `"autoMemoryEnabled": false` in the user's `~/.claude/settings.json` (or per project in `.claude/settings.json`) when most files land in delete; the moved lines in CLAUDE.md replace it.

### 5. Approve

Show one table, ranked by tokens saved: finding, tokens, fix, and per memory file the class with a one-line reason. With `--auto`, stop here and send the table as the report. Otherwise ask once with `AskUserQuestion` (multi-select): which config fixes to apply, whether to apply the memory plan as shown, and whether to turn auto memory off. Apply nothing that was not selected.

### 6. Apply

1. Memory, in this order:
   1. `node ${CLAUDE_SKILL_DIR}/scripts/memory.mjs backup [--project <cwd>] [--all]`. Note the backup path.
   2. Delete, write the merged files, and add the moved lines to `CLAUDE.md` or `.claude/rules/`.
   3. `node ${CLAUDE_SKILL_DIR}/scripts/memory.mjs reindex <memory-dir>` per dir. It rebuilds `MEMORY.md` from the frontmatter, so no orphan or dangling line is left. An empty dir gets an empty index.
   4. Run `memory.mjs list` again: no orphans, dangling lines, or broken links.
2. Config fixes: edit the settings, CLAUDE.md, rules, or hooks the user approved. For a settings change, load the `update-config` skill. A CLAUDE.md change in a repo is committed there on its default branch.
3. Run `baseline.mjs` again only if a change takes effect without a restart; otherwise say that the next session shows the effect.

### 7. Report

At most 10 lines: baseline before and the expected baseline after, carried tokens of the top 3 patterns, what changed, the memory backup path, and the fixes the user declined. Suggest running `/context` in a fresh session to confirm the new baseline.

## Running regularly

The audit reads local files in `~/.claude/`, so it must run on this machine: `/schedule` cloud agents cannot see them. Use `/loop 7d /context-audit --all --auto` in a long-running session, or a weekly local cron job with `claude -p "/context-audit --all --auto"`. Then run `/context-audit` interactively to apply the fixes you want.

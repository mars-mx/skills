---
name: issue-to-pr
description: Take a GitHub issue end to end to a mergeable PR - issue preflight, verification plan, Sonnet implementation, Ponytail review, tests, pre-pr-review, PR with CI and Claude review watch. Run as /issue-to-pr <issue>.
disable-model-invocation: true
argument-hint: "<issue number or URL>"
---

# Issue to PR

Take one issue from "open" to "PR the user can merge in the UI". You are the **orchestrator** (Opus): you plan, triage, decide, and judge. **Sonnet subagents** write code and tests from precise briefs. The user hears from you only at a **gate**.

Invoking this skill is the user's request for a feature branch and a PR. It overrides the default of committing on the default branch, and it counts as "the user asks" for opening the PR in `pre-pr-review`.

## Ground rules

- **Autonomy.** Find answers yourself: the issue and its comments, linked issues and PRs, the code, `CLAUDE.md`, `REVIEW.md`, docs, and `git log`. Decide minor forks yourself and record each decision with its reason in the plan; the PR body lists them under **Decisions**. Escalate only through a gate trigger in [references/gates.md](references/gates.md).
- **Silence.** From start to the final gate, send the user nothing but gate messages.
- **Gates.** A gate is red (blocks, needs the user) or the final green one. Before any gate message goes out, run the **gate check**: a fresh `general-purpose` subagent with `model: "sonnet"` works through that gate's checklist from `references/gates.md` against your evidence, using the verifier brief in [references/briefs.md](references/briefs.md). On REJECTED, act on its reasons and check again once. Rejected twice: send the gate with the verifier's dissent as an Evidence item. Send the message in chat, and also through `PushNotification` (load it with `ToolSearch` first) when available.
- **Subagents.** Implementers, fixers, test writers, and the gate verifier are fresh `general-purpose` agents with `model: "sonnet"`, never `fork` (a fork ignores `model` and inherits your context). Reviewers are fresh `general-purpose` agents on your model. Every brief follows the templates in `references/briefs.md`.
- **Caps.** Every fix loop runs at most 3 rounds, then its gate fires.
- **Evidence** is output observed in this run: a command and its result, a file and line, a screenshot path, a URL. A claim without evidence is unverified.
- **Run directory.** Keep all run files in `RUN_DIR=${TMPDIR:-/tmp}/issue-to-pr/<repo>-<issue>/`: `plan.md`, `verification.md`, logs, and `screenshots/`. Nothing from it is committed.

## Steps

### 1. Preflight (gate G0)

Check, in this order:

1. `gh auth status` passes and `gh issue view <issue>` returns the issue. `gh` is at least v2.99.0, which adds `--attach` for the PR screenshots:

   ```bash
   gh --version | node -e 'const [a,b]=require("fs").readFileSync(0,"utf8").match(/(\d+)\.(\d+)/).slice(1).map(Number);process.exit(a>2||(a===2&&b>=99)?0:1)'
   ```
2. The worktree is clean. You are on the default branch (`gh repo view --json defaultBranchRef`), pulled to `origin`.
3. The skills `pre-pr-review` and `ponytail:ponytail-review` are in your skill list.
4. The repo has an automated Claude reviewer: a workflow in `.github/workflows/` using `anthropics/claude-code-action` or `claude-code-security-review`, or a bot review on one of the last 10 merged PRs. Note its check-run name and bot login: if neither contains "claude", step 8 needs a `--reviewer` regex that matches one of them, never the workflow name. Also note its `on:` triggers: whether it re-runs on `synchronize` or offers `workflow_dispatch`.

Any failure fires G0. Then create the branch `issue-<n>-<slug>` from the default branch and assign the issue to the user, so the issue list shows what is in progress: `gh issue edit <issue> --add-assignee @me`.

### 2. Issue preflight (gate G1)

1. Read the issue, every comment, and linked issues and PRs. Map the code it touches with `Explore` subagents; keep their file dumps out of your context.
2. Write `RUN_DIR/plan.md`:
   - **Goal** and **acceptance criteria**, each one testable.
   - **Assumptions** table: assumption, evidence that supports it, `long-term` or `workaround`, and what breaks if it is wrong.
   - **Complexity**: `S` (one area, no contract change), `M` (several areas or a new behavior users see), `L` (schema, public API, auth, billing, cross-cutting refactor, or a new dependency).
   - **Slices**: the file-level change list, cut into slices one subagent can finish alone. Mark which slices touch disjoint files and can run in parallel.
3. Run the **plan review**: a reviewer subagent with the plan-review brief, which applies the Ponytail `ultra` rules (question every part the need does not justify) and judges each assumption as long-term or workaround. Rounds by complexity: `S` 1, `M` up to 2, `L` up to 3. Update the plan after each round. Keep `ultra` mode inside the reviewer; your own session stays at its level.

**Spec.** An issue with the label `spec:ready` was specced with the user by `issue-spec` (format: `${CLAUDE_SKILL_DIR}/../issue-spec/references/spec.md`). Take its Goal, Acceptance criteria, Out of scope, Edge cases, Decisions, Assumptions, Contracts and data model, Verification, UI spec, and Complexity into `plan.md` as they are: its decisions are the user's, its contract and data model changes were approved on the review artifact, and its additions are approved. The plan review then runs one round and judges only the slices and what the code changed since the spec. A spec that contradicts the current code (including an assumption the code disproves), or a spec story path missing on the default branch, fires G1.

Done when every assumption is backed by evidence or decided with a recorded reason, and no G1 trigger holds. A G1 trigger that holds fires G1.

### 3. Verification plan (gate G2)

Write `RUN_DIR/verification.md` with three categories: **Playwright** (browser tests of UI), **Unit**, and **E2E** (flows across process or service boundaries: API, worker, database). Per category, either:

- the planned tests: file, what each asserts (mapped to an acceptance criterion), and the command that runs them, or
- the skip reason. Valid reasons describe the change: "the change touches no UI", "the repo has no E2E harness and the change crosses no service boundary". The environment is never a valid reason: "it does not run locally right now" is a G2 trigger, not a skip.

With a spec, take the categories from its Verification section.

Then run the **baseline**: on the unchanged branch, run the command of every planned category plus the repo's typecheck, lint, and build. With a spec story, also start Storybook and screenshot every spec story in headless Chromium at each width in `ux.config.json` → `viewports` (missing: `[1440, 390]`), saved as `RUN_DIR/screenshots/<screen>-<state>-spec-<width>.png`, with screen and state taken from the story name (`CheckoutDefault` → `checkout-default`). Any failure or a harness that does not start fires G2 and ends the run. A broken environment is the user's to fix.

Done when every category has tests or a valid skip reason, and the baseline is green.

### 4. Implement

For each slice, dispatch a Sonnet implementer with the implementer brief. Run slices with disjoint files in parallel, in one message. After each slice returns, read its diff yourself and check it against the brief; send a fix brief for gaps. An edge case an implementer reports goes through `software-engineering:proportionality`; before you add handling for it, get a verdict from the `software-engineering:impact-review` agent. Commit each accepted slice.

Done when every slice is committed and the typecheck passes.

### 5. Implementation review (gate G3)

Dispatch a reviewer subagent with the implementation-review brief: it runs `ponytail:ponytail-review` on `git diff <default>...HEAD` with the `ultra` lens and checks the diff against `plan.md`. Triage each finding: fix, not applicable (with reason), or pre-existing. Group the fixes into Sonnet fix briefs, review their diffs, commit. Re-review only the diff since the last round, passing the findings already handled.

Done when a round returns no new Must fix or Should fix finding. After 3 rounds with new findings, G3 fires.

### 6. Verification (gate G4)

1. Dispatch Sonnet test writers with the test brief, one per category in `verification.md`.
2. Run every planned category plus typecheck, lint, and build. A red result goes back to you: diagnose the cause, then send a fix brief. Fix the code, not the test, unless the test contradicts an acceptance criterion.
3. If the change touches UI, take screenshots of every changed screen and state in headless Chromium, logged in the same way as the Playwright tests (their `storageState` file or setup project), at each width in `viewports`. Save them as `RUN_DIR/screenshots/<screen>-<state>-final-<width>.png`, with the same screen and state names as the spec screenshots. Compare each with its spec screenshot at the same width, desktop first; a placeholder region of the spec story is compared with its artboard in the Design artifact. Without a spec story, compare against the issue and, if the `ux-design` skill applies, against its spec.
4. With a spec story: delete it in a commit (`spec: remove #<issue> spec story`). Its screenshots from the baseline stay the reference.

Done when every command is green and the screenshots match. After 3 red rounds, G4 fires.

### 7. Pre-PR review (gate G5)

Invoke `pre-pr-review`. If the skill is not available, G5 fires and the run stops. Its fixes go through Sonnet fix briefs like step 5. Keep its **risk tier** and its PR body, and add **Decisions** from the plan to the body. For a UI change, add a **Screenshots** section: per screen and state, a table with a row per viewport (desktop first) and the columns Spec and Final. The cells reference the local files by their absolute path, as in `![Spec Desktop](/abs/RUN_DIR/screenshots/checkout-default-spec-1440.png)`; step 8 uploads them. Without a spec story, the table has only the Final column. Write the body to `RUN_DIR/pr-body.md`.

Done when `pre-pr-review` reports "ready for PR". "Blocked" fires G5.

### 8. PR and watch (gate G6)

1. Push the branch and open the PR with `gh pr create --body-file RUN_DIR/pr-body.md`, with `Closes #<issue>` in the body. Upload the screenshots in the same command with one `--attach '<path>#<alt text>'` per file, using the exact path the body references: `gh` uploads the file and rewrites that reference to the uploaded asset. Mind the limits from `gh pr create --help`:
   - At most 50 files per command. Attach the first 50; the rest goes up with `gh pr edit`.
   - If some uploads fail, the PR is still created with the ones that succeeded; the command exits non-zero and still prints the PR URL. Take the PR number from that URL, not from the exit code.

   For remaining or failed files: write the current body to a file (`gh pr view <pr> --json body -q .body > RUN_DIR/pr-body-current.md`), then run `gh pr edit <pr> --body-file RUN_DIR/pr-body-current.md --attach ...` with those files. Done when `gh pr view <pr> --json body` contains no path into `RUN_DIR`.
2. Start the watcher in the background (`run_in_background`):

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/pr-status.mjs <pr> --watch
   ```

   It exits when every check has finished and the Claude reviewer has run on the head commit, or after 60 minutes (exit 2). Pass `--reviewer <regex>` only when the AI reviewer is not named "claude"; the regex must match its check-run name or its author login, never the workflow name. If it matches neither once all checks have finished, the watcher exits 1 with the checks and authors it saw.
3. When it exits, read its JSON:
   - `checks.failing`: read the failed logs (`gh run view --log-failed`), diagnose, send a fix brief.
   - `aiReview.items` and `unresolvedThreads` from the reviewer: triage each finding as in step 5, send fix briefs, then reply to each thread with the fix commit or the reason it does not apply, and resolve it.
     Resolve a thread with the GraphQL `resolveReviewThread` mutation and the thread `id` from the JSON.
   - `behindBy > 0`: merge the default branch into the branch. Resolve conflicts that have one clear answer; otherwise G6 fires.
   - A fix that changes UI: take the final screenshots of the affected screens again, put their local paths back into the Screenshots cells of the current body, and upload them as in point 1.
   - Push, and start the watcher again. If the reviewer does not re-run on `synchronize`: trigger it with `gh workflow run <file> -f pr_number=<pr>` when it offers `workflow_dispatch`; otherwise add `--no-ai-wait`, so the watcher waits only for CI.

Done when the watcher reports `ready: true` and the last review round raised nothing new. After 3 rounds, a timeout, or a conflict without one clear answer, G6 fires.

### 9. Ready (gate G7)

Run `pr-status.mjs <pr>` once more without `--watch`, with the same `--reviewer` if step 8 used one, and confirm `ready: true`. `awaitingApproval: true` means branch protection waits only for a human approval; the PR is then mergeable in the UI right after the user approves. Decide whether the user must review, from the step 7 risk tier: `Low` needs no review, `Medium` and `High` do. Either way, merging stays with the user. Run the gate check for G7 and send the ready message from `references/gates.md`.

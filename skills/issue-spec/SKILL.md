---
name: issue-spec
description: Spec a GitHub issue with the user so /issue-to-pr can run it without questions - decisions, assumptions, testable acceptance criteria, verification plan, Ponytail ultra review, a technical review artifact of contract layers and data model changes, and for UI a Design artifact plus a Storybook spec story pushed to the default branch. Run as /issue-spec <idea or issue>.
disable-model-invocation: true
argument-hint: "<idea text, issue number, or issue URL>"
---

# Issue spec

Turn an idea or a thin issue into a **spec**: an issue that `issue-to-pr` can take to a PR without asking the user anything. `issue-to-pr` runs silently and stops at a gate for every open decision. This skill takes those decisions **with the user, up front**: it is interactive, where `issue-to-pr` is silent.

Invoking this skill is the user's request to commit and push the spec files (the spec story and, if needed, the Storybook glob) directly to the default branch, without asking again. The implementer branches from the default branch and finds the spec story only there.

## Ground rules

- **Questions only at real forks.** Find answers yourself first: the issue and its comments, linked issues and PRs, the code, `CLAUDE.md`, docs, and `git log`. Ask the user only when the possible answers lead to materially different work. Ask with `AskUserQuestion`, recommended option first. Minor choices you decide yourself and record as a decision with its reason.
- **Every answer becomes a decision** in the spec: what was decided, why, and whether it is `long-term` or `workaround`. A workaround names the long-term change it postpones.
- **Every assumption has evidence.** An assumption is what the spec takes as given without a decision. Its evidence is code (`file:line`), a doc, or the user's word. An assumption that nothing proves and that changes the work if it is wrong is a fork: ask, and it becomes a decision.
- **One issue, one PR.** The spec describes what one PR delivers.
- **Proportionality.** Before step 1, invoke `software-engineering:proportionality` with the Skill tool. Its order of thought shapes every design decision in the spec: the ideal first, then constraints, then fit inside the intended boundaries, then each edge case sized before it changes the design.
- **Run directory.** Keep drafts in `RUN_DIR=${TMPDIR:-/tmp}/issue-spec/<repo>-<issue or slug>/`. Nothing from it is committed.

## Steps

### 1. Preflight

1. `gh auth status` passes. For an issue argument, `gh issue view <issue>` returns it.
2. You are on the default branch (`gh repo view --json defaultBranchRef`), pulled to `origin`. Uncommitted changes of the user stay untouched: you commit only the spec files, by path.
3. Note whether the change can touch UI and the repo has `components.json` (then `ux-design` applies) and `.storybook/` (then a spec story is written).
4. **Orphaned spec stories:** for every `src/specs/<n>-*.spec.stories.tsx`, check `gh issue view <n> --json state`. Report each one whose issue is closed to the user in one line, with its path. Delete none without the user's answer.

### 2. Intake

Read the issue, every comment, and linked issues and PRs, or take the user's idea. Map the code it touches with `Explore` subagents; keep their file dumps out of your context. Look for the three things that would stop `issue-to-pr` at gate G1:

- an open question whose answers lead to different work,
- a fix that is only a workaround because the long-term fix needs a schema migration, a public API change, a cross-module refactor, or a new dependency,
- a contradiction between the request and the code, another issue, or a documented decision.

**Split** only a big feature, and only now, before any issue exists: complexity `L` that touches several independent areas or user flows. Propose the cut to the user as separate issues, each one PR, with their order (`Depends on #<n>`). Then spec each issue on its own. An existing issue is never split.

Done when you can name the goal, the affected areas, and every fork from the list above.

### 3. Clarify

Resolve every fork with the user, one question per fork. Write the draft spec to `RUN_DIR/spec.md` in the format of [references/spec.md](references/spec.md).

The draft fills `Assumptions` and `Contracts and data model` too: every contract and data model change with its before state from the code. Every edge case that came up goes into `Edge cases` with its share and the response from the `proportionality` ladder. A need of a later step goes into `Out of scope` with the addition it will fit in as.

Done when the draft has no open question, every acceptance criterion is testable, every assumption has evidence, and every Verification category has planned tests or a valid skip reason.

### 4. Plan review

Dispatch a fresh `general-purpose` reviewer on your model with the draft and this brief:

```
Review this spec for <repo>#<issue> as Ponytail at level ultra: a lazy senior developer who questions every part of the request the need does not justify. Read the issue and the code the spec touches before you judge.

<spec.md>

Report:
1. Parts to cut or shrink: what the need does not justify, with the reason.
2. Per decision: holds or not, with evidence (file:line, issue comment); long-term or workaround; what breaks in a year if it is a workaround.
   Per assumption: does its evidence hold. Per contract or data model change: is it needed, and is it breaking or additive.
3. Existing code the change should reuse instead of adding (path).
4. Acceptance criteria that are not testable, and why.
Every point needs a concrete case. Change no files.
```

Bring each cut and each failed decision to the user; scope cuts are the user's call. Update the draft. Rounds by complexity: `S` 1, `M` up to 2, `L` up to 3.

Then run the **proportionality review**: dispatch the `software-engineering:proportionality-review` agent with the draft, the issue, and the paths of the affected areas, and ask for a verdict on every entry in `Edge cases`, every decision that treats a subset of cases differently, and every later need in `Out of scope`. Bring each verdict that differs from the draft to the user, with the agent's reason; an "insufficient evidence" verdict becomes a fork or a measurement before the spec goes on. Update the draft.

Done when the last plan review round raises nothing new or the round cap is reached, and every proportionality verdict matches the draft or the user decided against it.

### 5. Technical review

Skip this step for complexity `S` with no contract or data model change, and record `skip` for the review artifact in the spec.

Check that the draft's `Assumptions` and `Contracts and data model` are complete. The issue body stays the source of truth: the page renders the spec and the code, and adds nothing the spec lacks. Then dispatch a fresh `general-purpose` subagent on your model with this brief:

```
Build a review page for the spec of <repo>#<issue number or slug>. A human reads it to approve the technical design before an agent implements it without asking anyone. Optimize for a fast, sure review. Write it in the spec's language.

Spec: <RUN_DIR/spec.md>. Repo: <repo path>. Read the code the spec names. Change no files in the repo.

Create the page with the Artifact tool: first `action: "quickstart"` with `intent: "other"`, then follow what it returns, including the artifact-design skill. Draw diagrams as the artifact-diagramming skill says. Write the HTML to your scratchpad directory.

The page, top to bottom:
1. Header: issue, goal, complexity.
2. Decisions: every row of the spec's Decisions table, word for word, with reason, kind, and source. Mark workarounds visually, with the long-term change they postpone.
3. Assumptions: every row of the spec's Assumptions table, word for word, with evidence and what breaks if it is wrong.
4. Contract layers: the layers the repo actually has, such as DB schema, domain types, service interfaces, API surface, events and queues, client types. A diagram shows all layers and highlights the changed ones. Per changed contract: before (copied from the code with file:line, never reconstructed), after, a red and green diff, breaking or additive, and the affected consumers by path.
5. Data model: an entity-relationship diagram with the changed entities highlighted, a field table (field, type, nullable, default, index, change), and the migration: steps, backfill, lock or downtime risk, and rollback.
Every statement comes from the spec or the code. A disagreement between spec and code goes at the top of the page.

Report: the artifact URL, the HTML path, and every disagreement between spec and code.
```

A disagreement goes back into the draft; where its fix is a fork, ask the user. Give the user the page URL. Their corrections become decisions with source `user`, or assumptions with evidence `user`, in the draft; send them to the same subagent with `SendMessage`, so it republishes the same HTML path to the same URL. The user's confirmation is the technical approval.

Done when the user confirmed the page, the spec lists its URL, and page and spec agree.

### 6. UI spec

Skip this step when the change touches no UI or `ux-design` does not apply.

Start Storybook with the repo's `storybook` script if it is not running. Invoke the `ux-design` skill in **spec mode**: its steps 1 to 3 only. Its step 3 subagent creates the Design artifact and, with Storybook, the spec story `src/specs/<issue>-<slug>.spec.stories.tsx`. For a new idea, create the issue first without the `spec:ready` label (step 8), so the story can carry its number.

Give the user the artifact and the story URL in the running Storybook. Their confirmation is the design approval: it approves the screens, states, and the **Additions** the artifact lists. Record the approved additions with their tier in the spec. No further question follows; step 8 pushes.

Done when the user confirmed the artifact and the story, and the spec lists the artifact URL, the story path, the viewports from `ux.config.json`, and the approved additions.

### 7. Ready check

Dispatch a fresh `general-purpose` subagent with `model: "sonnet"`:

```
You check a spec before an automated agent implements it without asking anyone. Be skeptical: every gap you miss stops the agent later.

<spec.md>

Answer each item with yes or no and the evidence you looked at:
1. Every acceptance criterion is testable: a test can pass or fail on it.
2. No open question is left, in the spec or in the issue thread (gh issue view <issue> --comments).
3. Every decision has a reason; every workaround names the long-term change it postpones.
4. Every edge case has its share, the cost of a wrong result, and a response; every later need in Out of scope names the addition it will fit in as.
5. Every Verification category has planned tests or a reason that describes the change, not the environment.
6. For UI: the spec story exists, every screen and state in the spec has a story, and the approved additions are listed with their tier.
7. The spec agrees with the code: run read-only checks (grep, git log) in <repo path> on the files it names. Every assumption's evidence holds.
8. Unless the review artifact is skipped: the page at its URL (Artifact tool, `action: "read"`) shows every decision and assumption of the spec unchanged, and its contracts and data model match the spec's `Contracts and data model`.
End with `CONFIRMED` or `REJECTED: <what to change>`.
```

On REJECTED, fix the spec (asking the user where the fix is a fork), have the step 5 subagent republish the page if the fix touches it, and check again once. Rejected twice: show the user the verifier's reasons and let them decide.

### 8. Publish

1. **Issue.** A new idea that step 6 did not already create: `gh issue create` with the spec as body. An issue step 6 created: `gh issue edit --body-file` with the spec. An existing issue: `gh issue edit --body-file`, with the original body kept in a `<details><summary>Original issue</summary>` block at the end.
2. **Spec files**, only when step 6 wrote a story:
   - Check that the Storybook `stories` globs in `.storybook/main.*` cover `src/specs/`. If not, add `../src/specs/**/*.stories.@(ts|tsx)` to them.
   - Run typecheck, lint, and every story check the repo runs in CI (Storybook build, test runner or Vitest addon, visual tests). Fix the story until they are green. The default branch must stay green.
   - Commit only the spec files, by path: `git add -- <paths>`, then `git commit -m "spec: #<issue> <title>" -- <paths>`. Then `git pull --rebase --autostash` and `git push origin <default>`.
   - A rejected push, or a rebase that stops on a conflict, fires the **push gate** below. The issue then does not get `spec:ready`.
3. **Label.** `gh label create spec:ready --color 0E8A16 --description "Spec complete, ready for /issue-to-pr" --force`, then `gh issue edit <issue> --add-label spec:ready`.

Done when the issue carries `spec:ready`, its body has the spec, and the spec story is on `origin/<default>` (`git log origin/<default> -1 -- <story path>` shows the commit).

Report to the user: the issue URL, the review page URL unless skipped, the story path, and `/issue-to-pr <issue>` as the next step.

## Push gate

A red gate, sent in chat and through `PushNotification` (load it with `ToolSearch` first) when available, in German:

```
🔴 Push Spec-Story · <repo>#<issue>
Problem: Der Push der Spec-Story auf <default> wurde abgelehnt.
Grund für Gate: Ohne die Story auf <default> findet issue-to-pr keine Referenz; das Issue bleibt ohne spec:ready.
Evidence:
- git push origin <default> → <rejection line, e.g. "protected branch hook declined">
- Commit: <sha> <story path>
```

---
name: review-setup
description: Set up a repo for agent-scale code review (REVIEW.md, CLAUDE.md checks, PR template, risk tiers, CODEOWNERS), following the Claude Code team's process.
disable-model-invocation: true
---

# Review setup

Adopt the Claude Code team's review process ([source](https://claude.dev/blog/solving-code-review-at-anthropic/)) in the current repo. The goal: minimal human review time per change, with revert and incident rates as the guardrail.

Every file you write is a draft for the code owners. Ground each line in evidence from this repo (a file, a command that ran, a past incident), never in a guess from a name. When a file already exists, merge into it and keep what the owners wrote.

## Steps

### 1. Survey

Read the repo: language and stack, `package.json` scripts / `Makefile` / CI workflows, existing `CLAUDE.md`, `REVIEW.md`, PR template, `CODEOWNERS`, and the git log for reverts (`git log --oneline -i --grep=revert -n 50`).

Done when you can name: the test, lint, typecheck, and build commands; the top-level areas of the codebase; and the sensitive paths (auth, billing, payments, secrets, CI and release workflows, installers, auto-updaters, migrations).

### 2. Verify the checks

Run each test, lint, typecheck, and build command you found. Record which pass, which fail, and how long each takes.

Done when every command has an observed result. A command you could not run gets listed as unverified in the final report.

### 3. `CLAUDE.md`

Add a short "Checks" section listing the commands from step 2, with the rule that the agent runs them and shows the output before claiming success. Keep `CLAUDE.md` short: stack, conventions, goals, non-goals, and links out to longer docs. Every review loads it.

If the repo has a formatter, propose a `PostToolUse` hook on `Edit|Write` in `.claude/settings.json` that runs it. Show the hook and apply it only after the user agrees.

### 4. `REVIEW.md`

Write `REVIEW.md` at the repo root from [`references/review-md.md`](references/review-md.md). Fill one section per area from step 1, each saying what failure looks like there.

Done when every area has a concrete failure statement, the skip list names real paths, and the evidence and summary rules are present.

### 5. PR template

Add to `.github/pull_request_template.md` (or the repo's existing template) these sections, each with a one-line prompt:

- **Testing**: the commands run and their result, plus screenshots for UI.
- **Risk**: the tier from `docs/risk-tiers.md` and why.
- **How to revert**: the revert commit, the flag to turn off, or the migration to roll back.

### 6. Risk tiers

Write `docs/risk-tiers.md` from [`references/risk-tiers.md`](references/risk-tiers.md). Fill the path lists with the real paths from step 1. Start strict: when unsure, a path goes in a higher tier.

### 7. `CODEOWNERS`

Add `CODEOWNERS` entries for every always-human path from the risk tiers, including `.github/workflows/`. Use the owners the user names; if none are named, ask once and leave `@TODO-owner` placeholders for the rest.

### 8. Settings you cannot apply

Print a checklist of settings the user applies in the hosting platform:

- Branch protection on the default branch: required CI, required conversation resolution, required CODEOWNERS review, and dismiss stale approvals on new commits.
- A merge queue, if the platform has one.
- An AI reviewer on this one repo first: Code Review for Claude Code or the `anthropics/claude-code-action` GitHub Action, plus the `anthropics/claude-code-security-review` Action. Bot approvals never count toward required human approvals.
- Feature flags, staged releases, and one-step rollback, where they are missing.

### 9. Report

Report, starting with counts: files created, files changed, checks verified, and checks unverified. Then list the settings checklist from step 8 and the follow-ups:

- Tune `REVIEW.md` for a few weeks on this repo, then widen to other repos.
- Move every review comment that repeats into `REVIEW.md`, a lint rule, or `CLAUDE.md`.
- Turn incidents and reverts into an eval set for the reviewer.
- Measure human approvals per PR and time waiting on a person, against revert and incident rates.

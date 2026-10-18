---
name: pre-pr-review
description: Verify, risk-tier, and review a change before opening a pull request, with capped review rounds. Use before opening or updating a PR, or when the user asks for a pre-PR check.
---

# Pre-PR review

Get a change to a state where a human reviewer only needs to read the evidence. Follows the Claude Code team's process ([source](https://claude.dev/blog/solving-code-review-at-anthropic/)).

Evidence means output you observed in this session: a command and its result, a screenshot, a review finding with file and line. A claim without evidence is unverified, and the PR body says so.

## Steps

### 1. Scope

Find the diff base (the merge-base with the default branch) and read the full diff. Read `CLAUDE.md` and `REVIEW.md` if they exist.

Done when you can state in one sentence what the change does and which paths it touches.

### 2. Verify

Run the repo's checks: tests, lint, typecheck, and build. Take the commands from `CLAUDE.md`, else from `package.json` scripts, `Makefile`, or CI workflows. For a UI change, run the app and look at the changed screen.

Fix failures the diff caused and run again. Done when every check is green, a failure is shown to exist on the base branch too, or the repo has no checks, which Testing then lists as unverified.

### 3. Tier

Classify the change with `docs/risk-tiers.md` if the repo has one. Otherwise use:

- **Low**: docs, copy, tests, additive changes behind a flag.
- **Medium**: ordinary product changes.
- **High**: auth, billing, secrets, CI or release workflows, installers, migrations, public API changes.

The most sensitive path in the diff sets the tier.

### 4. Review

Run the `code-review` skill on the diff at the depth the tier sets: Low → `low`, Medium → `medium`, High → `xhigh`. Also run `security-review` for Medium and High, and for any tier that touches input handling, auth, or secrets. If those skills are unavailable, dispatch a fresh-context subagent with the diff, `CLAUDE.md`, and `REVIEW.md`, and ask for findings with file, line, and severity.

Before round 1, record a checkpoint: commit the change as a WIP commit and note its SHA. Then work the findings in rounds:

1. Fix each finding, or record why it does not apply.
2. When a finding belongs to a class (a missing null check, an unescaped query), fix every instance of the class in the diff.
3. Review again, this time only `git diff <checkpoint>`: the fixes since the last round. Hand that diff to a fresh-context subagent along with the findings already posted, so it reports only new ones. Then commit and move the checkpoint.

Stop after 3 rounds. If findings still come in after round 3, stop fixing and tell the user the approach likely needs rethinking, naming the findings that keep recurring. A finding the diff did not introduce is tagged Pre-existing and goes in the report; it needs no fix in this PR.

Done when every finding is fixed, recorded as not applicable with a reason, tagged Pre-existing, or the round cap is reached.

### 5. PR body

Write these sections, keeping any other sections the repo's PR template has:

- **Summary**: what changes and why, in two or three sentences.
- **Testing**: each command run and its result, plus screenshots for UI. List anything unverified.
- **Risk**: the tier and the path or behavior that set it.
- **How to revert**: the revert, the flag to turn off, or the migration to roll back.
- **Review**: rounds run, findings fixed, findings dismissed with reasons, and Pre-existing findings.

### 6. Report

Start with the result: ready for PR, or blocked. Then the tier and the count of open findings. Show the PR body. Open the PR only when the user asks.

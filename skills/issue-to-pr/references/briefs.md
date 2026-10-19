# Subagent briefs

Fill every `<...>`. A Sonnet brief is complete when the agent needs no file outside the ones it names and makes no design decision of its own: you made them in `plan.md`. Paste the relevant plan excerpt into the brief; the subagent cannot see your context.

## Implementer (Sonnet)

```
You implement one slice of a planned change in <repo path>. Work only on this slice.

Goal of the whole change: <one sentence from plan.md>
This slice: <what it adds or changes, in two or three sentences>

Files to change:
- <path>: <exact change: function, signature, behavior>
Files to read for context, not to change:
- <path>: <why: the pattern to copy, the caller to keep working>

Follow the existing pattern in <path:lines>. Use <existing helper or component> for <purpose>.
Decisions already made: <decisions from plan.md that touch this slice>
Approved UI additions: <additions from the spec with their tier, or none>. These are approved by the user; build them in the catalog with a story, without asking.
Out of scope: every file not listed above. If the slice needs a change outside its files, stop and report it instead of making it.

Done when:
- <acceptance criterion 1, checkable>
- <command> passes (typecheck or the slice's existing tests)

Do not commit. Reply with: the files changed, the command output, and anything you could not do with its reason.
```

## Fix (Sonnet)

```
You fix review findings in <repo path>. Fix exactly these, nothing else:

1. <file:lines> - Problem: <the concrete case>. Fix: <the change you decided>.
2. ...

A finding of a class (a missing null check, an unescaped query) is fixed at every instance in these files: <paths>.

Done when every finding is fixed and <command> passes. Do not commit. Reply with: per finding, the change made (file:lines), and the command output.
```

## Test writer (Sonnet)

```
You write the <Playwright | Unit | E2E> tests for a change in <repo path>.

What changed: <summary of the diff, with paths>
Tests to write (from verification.md):
- <test file>: <case> asserts <expected result> (acceptance criterion <n>)

Copy the setup of <existing test file>: its fixtures, auth (<storageState or setup project>), and helpers. Each test fails if the behavior it covers breaks; check that by reasoning about the assertion, not by changing the code.

Done when <command> runs the new tests and they pass. If a test fails because the code is wrong, keep the test and report the failure. Do not commit. Reply with: the test files, the command output.
```

## Plan review (orchestrator model)

```
Review this plan for issue <repo>#<issue> as Ponytail at level ultra: a lazy senior developer who questions every part of the request the need does not justify. Read the issue (gh issue view <issue> --comments) and the code the plan touches before you judge.

<plan.md>

Report:
1. Parts to cut or shrink: what the need does not justify, with the reason.
2. Per assumption: holds or not, with evidence (file:line, issue comment); long-term or workaround; what breaks in a year if it is a workaround.
3. Existing code the plan should reuse instead of adding (path).
4. Questions only the issue author can answer, and why the code cannot.
Every point needs a concrete case. Change no files.
```

## Implementation review (orchestrator model)

```
Run the ponytail:ponytail-review skill on `git diff <default>...HEAD` in <repo path>. Apply the Ponytail ultra lens: also flag code the issue does not need.
Also check the diff against this plan and report every acceptance criterion it misses or exceeds:

<plan.md goal, acceptance criteria, decisions>

<Round 2+: only review `git diff <checkpoint>`. Findings already handled, do not report them again: <list>>

Report in the ponytail-review format. Change no files.
```

## Gate check (Sonnet)

```
You verify a gate in an automated issue-to-PR flow before its message goes to the user. Be skeptical: a red gate the agent could have resolved itself wastes the user's time; a green gate that hides a real problem ships a bug.

Gate: <id and name>
Checklist:
<the gate's checklist from gates.md>

Draft message:
<the message>

Evidence and context:
<command outputs, file paths, pr-status JSON, plan.md excerpt>

You may run read-only commands (git, gh, grep, the test command once) in <repo path> to check an item. Answer each checklist item with yes or no and the evidence you looked at. End with `CONFIRMED` or `REJECTED: <what the agent should do instead>`.
```

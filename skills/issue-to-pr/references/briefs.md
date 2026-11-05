# Subagent briefs

Fill every `<...>`. A Sonnet brief is complete when the agent needs no file outside the ones it names and makes no design decision of its own: you made them in `plan.md`. Paste the relevant plan excerpt into the brief; the subagent cannot see your context.

## Implementer (Sonnet)

```
You implement one slice of a planned change in <repo path>. Work only on this slice.

Goal of the whole change: <one sentence from plan.md>
This slice: <what it adds or changes, in two or three sentences>

Files to change:
- <path>: <exact change: function, signature, behavior>
- <test file>: the tests of this slice
Files to read for context, not to change:
- <path>: <why: the pattern to copy, the caller to keep working>

Follow the existing pattern in <path:lines>. Use <existing helper or component> for <purpose>.
Decisions already made: <decisions from plan.md that touch this slice>
Approved UI additions: <additions from the spec with their tier, or none>. These are approved by the user; build them in the catalog with a story, without asking.
Out of scope: every file not listed above. If the slice needs a change outside its files, stop and report it instead of making it.
Public APIs and data model: change only what is listed here: <Architecture diff entries that touch this slice, or none>. Update every caller of a changed API in the files above; build no shim, wrapper, alias, or deprecation path. If the slice needs any other API or data model change, stop and report it.
Edge cases: handle only what the acceptance criteria require. For any other edge case you meet, report it with the share of cases it affects instead of adding logic for it.

Seams: write tests only at these public interfaces. A test anywhere else is not allowed.
- S<n> <interface>: catches <...>, misses <...>

Work test-first, one acceptance criterion per cycle, in this order:
1. AC <n> at S<n>, test command <command>: <criterion>
2. ...
Criteria without a cycle, tested later in the finished UI: <criteria, or none>. Implement them minimally; write no test for them.

Per cycle:
1. Write one test for the criterion at its seam. For an interface that does not exist yet, first add a stub with its signature from "Files to change" (an empty body or a placeholder return value), so the test compiles.
2. Run it. It must fail on its assertion, for the reason the criterion names. A syntax, import, or setup error is not red: fix the test and run it again. Record the red output.
3. Write only enough code to pass this test. Do not anticipate the next criterion.
4. Run it and the slice's earlier tests. Record the green output. Then start the next cycle.
Never write all tests first and then all code. Do not refactor; that comes later in review.

Rules for every test:
- Test behavior through the seam's public interface. Never test private functions, and never verify through a side channel such as a database query instead of the interface.
- Mock only system boundaries: external APIs, time, randomness. Never mock your own modules or internal collaborators. A test that breaks on a refactor without a behavior change is wrong.
- Take expected values from an independent source: a literal, a worked example, the criterion. Never recompute them the way the code does.
- One behavior per test. The test name says what the behavior is, not how the code does it.

Done when:
- every criterion above has a cycle with a red and a green output
- <command> passes (typecheck and the slice's tests)

Do not commit. Reply with: per cycle, the test name, the red output, and the green output; the files changed; the final command output; and anything you could not do with its reason.
```

## Fix (Sonnet)

```
You fix review findings in <repo path>. Fix exactly these, nothing else:

1. <file:lines> - Problem: <the concrete case>. Fix: <the change you decided>.
2. ...

A finding of a class (a missing null check, an unescaped query) is fixed at every instance in these files: <paths>.
For a test finding: test only through the seam's public interface, mock only system boundaries, and take expected values from the criterion or a known literal, never recomputed the way the code does.

Done when every finding is fixed and <command> passes. Do not commit. Reply with: per finding, the change made (file:lines), and the command output.
```

## Test writer (Sonnet)

```
You write the <Playwright | Unit | E2E> tests for a change in <repo path>.

What changed: <summary of the diff, with paths>
Tests to write (from verification.md):
- <test file>: <case> at seam S<n> <interface> asserts <expected result> (acceptance criterion <n>)

Test only at the seams named above, through their public interface. Mock only system boundaries. Take expected values from the criterion or a known literal, never recomputed the way the code does.
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
5. Per special case (logic, cap, threshold, lock, retry, flag, or mode for a subset of cases): the share it affects, whether a lower response holds (accept and mark, then contain at the edge, then redesign), and whether it changes behavior for unaffected cases or crosses a service boundary.
Every point needs a concrete case. Change no files.
```

## Implementation review (orchestrator model)

```
Run the ponytail:ponytail-review skill on `git diff <default>...HEAD` in <repo path>. Apply the Ponytail ultra lens: also flag code the issue does not need.
Also check the diff against this plan and report every acceptance criterion it misses or exceeds. Report as Must fix every compatibility layer (shim, wrapper, alias, deprecation path) the plan does not name, and every public API or data model change the Architecture diff does not show.
Also check every new or changed test, and report as Must fix:
- implementation-coupled: mocks an internal collaborator, tests a private function, asserts call counts or order, or verifies through a side channel instead of the interface
- tautological: the expected value is recomputed the way the code computes it, or the assertion cannot fail
- a test at a seam the plan does not list

<plan.md goal, acceptance criteria, Architecture diff, seams, decisions>

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

---
name: issue-spec
description: Spec a GitHub issue with the user in three layers - intent, architecture, implementation - so /issue-to-pr can run it without questions. Every question is settled in chat first; the issue only records what was agreed - user stories, acceptance criteria, an architecture diff, decisions, and for UI screenshots of the Design artifact. Run as /issue-spec <idea or issue>.
disable-model-invocation: true
argument-hint: "<idea text, issue number, or issue URL>"
---

# Issue spec

Turn an idea or a thin issue into a **spec**: an issue that `issue-to-pr` can take to a PR without asking the user anything. `issue-to-pr` runs silently and stops at a gate for every open decision. This skill takes those decisions **with the user, up front, in chat**.

Invoking this skill is the user's request to export the Design artifact's PNGs through Claude in Chrome, to confirm its "Save this file?" dialog, and to save the ZIP, without asking again.

The issue is the written record of what was agreed, not a place to agree. The user should find nothing in it they have not seen in chat. A question that only comes up while writing the issue is a failure of this skill.

## Layers

```
E1 Intent          what it is about, from the customer and the architecture view  → user confirms
E2 Architecture    areas touched, how they integrate, public API, data model      → user approves
E3 Implementation  everything else                                                → you decide, never ask
```

The depth follows the change. One skill runs everything, from a label change to a new integration:

```
label or copy change      E1 one line · E2 "no API, no data model, no UI" · 0 questions
small behavior change     E1 two sentences · E2 small diff · 0–1 questions
new integration, schema   E1 + E2 in full · questions on API, data, boundaries only
```

## Ground rules

- **Questions only on E1 and E2.** Find answers yourself first: the issue and its comments, linked issues and PRs, the code, `CLAUDE.md`, docs, and `git log`. Ask only when the possible answers lead to a different intent, a different public API, a different data model, or different module boundaries. Everything in E3 you decide yourself. The exception is a critical E3 finding: one that risks security, data loss, money, or a break for consumers outside the repo.
- **How to ask.** Never use `AskUserQuestion`. Ask in chat as numbered lines, each with your recommendation: `1. <question> → Empfehlung: <answer>`. The user answers with `1 nein` or `ok`.
- **Short.** Chat in the user's language. Every message fits on one screen. Show structure as ASCII diagrams and `diff` blocks, not as prose. Code blocks hold only diagrams and diffs, never sentences: the terminal wraps long lines in a code block and breaks the alignment. No recap of what the user said, and no text around the E1 and E2 templates.
- **Simplest variant.** Every new persistent structure (table, queue, service, dependency, compatibility layer) appears in E2 next to the simplest alternative that meets the goal, each with its cost: new parts, rows, migrations. The new structure needs a concrete reason the simplest variant fails.
- **No compatibility layers by default.** Internal APIs change, and every caller is updated in the same PR. Compatibility is only for consumers this PR cannot change: published packages, shipped clients, persisted data and events, external webhooks. Each compatibility layer is an E2 question.
- **Proportionality.** Before the E2 draft, invoke `software-engineering:proportionality` with the Skill tool. Its order of thought shapes the architecture: the ideal first, then constraints, then fit inside the intended boundaries.
- **Every answer becomes a decision** in the spec: what was decided, why, and whether it is `long-term` or `workaround`. A workaround names the long-term change it postpones.
- **Every assumption has evidence:** code (`file:line`), a doc, or the user's word. An assumption that nothing proves and that changes E1 or E2 if it is wrong is a question.
- **One issue, one PR.**
- **Run directory.** Keep drafts and screenshots in `RUN_DIR=${TMPDIR:-/tmp}/issue-spec/<repo>-<issue or slug>/`. Nothing from it is committed.

## Steps

### 1. Preflight

1. `gh auth status` passes, and `gh --version` is at least v2.99.0, which adds `--attach` for the screenshots. For an issue argument, `gh issue view <issue>` returns it.
2. Note whether the change can touch UI and the repo has `components.json`. Then `ux-design` applies and step 5 runs.

### 2. Intake

Silent. Read the issue, every comment, and linked issues and PRs, or take the user's idea. Map the code it touches with `Explore` subagents; keep their file dumps out of your context.

**Split** only a big feature, and only now, before any issue exists: complexity `L` that touches several independent areas or user flows. Propose the cut to the user as separate issues, each one PR, with their order (`Depends on #<n>`). Then spec each issue on its own. An existing issue is never split.

Done when you can state the intent in two sentences, or name the one point that keeps you from it.

### 3. E1 Intent

Send exactly this, as plain Markdown, not in a code block:

```markdown
**E1**
- **Kunde:** <one sentence, at most 20 words: who gets what>
- **Architektur:** <one sentence, at most 20 words: which areas take part, no mechanism>
- **Stories:**
  1. Als <role> will ich <x>, damit <y>.
```

At most three stories, one line each. E1 names no table, service, endpoint, or sync job; those belong in E2. Something you found in the code that goes beyond the issue becomes a question here only if it changes the intent; otherwise it waits for E2.

If you cannot write the two sentences, send only the one unclear point as question 1. Wait for the user's confirmation. Their corrections replace your sentences.

**Fast path.** For complexity `S` with no public API, data model, or UI change, send E1 and E2 as one message, skip the reviews in step 4, and go on with step 6 after the user's `ok`.

Done when the user confirmed E1.

### 4. E2 Architecture

1. **Draft.** Write the architecture diff in the three blocks of [references/spec.md](references/spec.md): components, public API, data model. Show only what changes and its direct neighbors. Add the simplest-variant line, and the assumptions E2 rests on with their evidence.
2. **Review, silently.** Before the user sees the draft, dispatch a fresh `general-purpose` reviewer on your model with this brief:

   ```
   Review this architecture for <repo>#<issue> as Ponytail at level ultra: a lazy senior developer who questions every part the need does not justify. Read the issue and the code it touches before you judge.

   Intent: <E1 as confirmed>
   <E2 draft>

   Report:
   1. Parts to cut or shrink: new tables, queues, services, dependencies, API changes, or compatibility layers the need does not justify, with the simpler alternative.
   2. Per assumption: does its evidence hold (file:line).
   3. Existing code to reuse instead of adding (path).
   4. Callers of every changed API (paths), and whether any is outside the repo.
   Every point needs a concrete case. Change no files.
   ```

   Then dispatch the `software-engineering:proportionality-review` agent with the intent, the draft, and the paths of the affected areas, for a verdict on every new structure and every decision that treats a subset of cases differently.

   Merge both into the draft. Rounds by complexity: `M` 1, `L` up to 2.
3. **Send E2** as plain Markdown. Only the diagram and the diffs are code blocks:

   ````markdown
   **E2**

   **Komponenten** (+ neu, * geändert, - entfernt)
   ```
   [orders-api]* ──ReturnCreated──▶ [dashboard]*
   ```

   **Public API**
   ```diff
     GET /orders → Order[]
   +   returns: Return[]
   ```

   **Datenmodell:** keine Änderung

   **Einfachste Variante:** = Vorschlag | <variant>: <cost> · Vorschlag: <cost> · Grund: <why the simple one fails>

   **Fragen**
   1. <question> → Empfehlung: <answer>
   ````

   Diagram lines stay under 70 characters, so the terminal does not wrap them.

   Review findings appear only as questions, and only when they change E1 or E2 or are critical. The rest you decide.

Repeat with the user's answers until no question is left. Done when the user approved E2.

### 5. UI

Skip this step when the change touches no UI or `ux-design` does not apply.

1. Invoke the `ux-design` skill in **spec mode**: its steps 1 to 3 only. Its subagent creates the Design artifact. Give the user the artifact URL; their confirmation approves the screens, the states, and the **Additions** the artifact lists. Corrections go back to the same subagent with `SendMessage`.
2. **Export the screenshots** with Claude in Chrome (load its tools with `ToolSearch`). Open the artifact URL in a new tab, then **Share › Export › PNG**, choose **2×**, **Select all**, **Export**, and confirm **Save file** in the "Save this file?" dialog. Chrome saves `<artifact title>-png.zip` to the downloads folder, with one PNG per artboard, named after the artboard title. Unzip it into `RUN_DIR/screenshots/` and close the tab. Without Claude in Chrome, for example on a server, ask the user to run the same export and to send the ZIP path.

Done when the user confirmed the artifact and every screen, state, and viewport from `ux.config.json` has a PNG named `<screen>-<state>-<width>.png`.

### 6. Write the spec

Silent. Write `RUN_DIR/spec.md` in the format of [references/spec.md](references/spec.md). It takes E1, the stories, E2, and the user's answers as agreed, and draws the component diagram from E2 as Mermaid. You add only E3 content: acceptance criteria derived from the stories, the out-of-scope list, complexity, and affected areas.

Done when every story has at least one testable acceptance criterion and nothing in the spec contradicts the chat.

### 7. Ready check

Dispatch a fresh `general-purpose` subagent with `model: "sonnet"`:

```
You check that a spec matches what the user agreed before an automated agent implements it without asking anyone. Be skeptical: every gap you miss stops the agent later.

<spec.md>

Agreed in chat:
<E1 as confirmed, E2 as approved, every question with the user's answer>

Answer each item with yes or no and the evidence you looked at:
1. Every section the format does not allow to be left out is present, in order.
2. Every user story has at least one acceptance criterion, and every acceptance criterion names its story and is testable: a test can pass or fail on it.
3. The Architecture diff shows the same components, API changes, and data model changes as the approved E2, nothing more or less.
4. Every user answer appears as a decision; every decision has a reason; every workaround names the long-term change it postpones.
5. The spec agrees with the code: run read-only checks (grep, git log) in <repo path> on the files it names. Every assumption's evidence holds.
6. For UI: <RUN_DIR/screenshots> has a PNG for every screen, state, and viewport the UI section lists.
End with `CONFIRMED` or `REJECTED: <what to change>`.
```

On REJECTED, fix the spec and check again once. A fix that needs the user's answer is this skill's failure: say so in one line, then ask the question in chat.

### 8. Publish

1. **Issue.** The UI section references each screenshot by its absolute path, as in `![checkout-default-1440](/abs/RUN_DIR/screenshots/checkout-default-1440.png)`. Pass one `--attach '<path>#<screen>-<state>-<width>'` per file with the same path: `gh` uploads it and rewrites the reference. At most 50 files per command.
   - A new idea: `gh issue create --body-file RUN_DIR/spec.md --attach ...`.
   - An existing issue: `gh issue edit <issue> --body-file RUN_DIR/spec.md --attach ...`, with the original body kept in a `<details><summary>Original issue</summary>` block at the end.

   If some uploads fail, the command exits non-zero and still writes the issue; attach the rest with `gh issue edit`. Done when `gh issue view <issue> --json body` contains no path into `RUN_DIR`.
2. **Label.** `gh label create spec:ready --color 0E8A16 --description "Spec complete, ready for /issue-to-pr" --force`, then `gh issue edit <issue> --add-label spec:ready`.

Report in two lines: the issue URL, and `/issue-to-pr <issue>` as the next step. Do not ask the user to review the issue.

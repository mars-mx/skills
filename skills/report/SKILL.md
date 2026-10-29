---
name: report
description: Report a wrong turn from this session as a GitHub issue on the mars-mx/skills repo, with a Sonnet analysis of where and why Claude went wrong and which rule would have prevented it.
disable-model-invocation: true
argument-hint: <what went wrong, in your words>
---

# Report

Turns a wrong turn from this session into an issue that improves the skills. The user's note: $ARGUMENTS

The repo `mars-mx/skills` is **public**. The issue describes only the general pattern of the wrong turn, as it could happen in any codebase. It contains no implementation details, code or code patterns from the project, and no project, company, customer, person, service, table, or file names, URLs, or identifying numbers. Example: "2 of 255 stores hit a list cap, so a cap of 12,500 was applied to all stores" becomes "a limit that hits a small share of tenants was applied to all tenants".

## Steps

1. **Condense the transcript.** Run `${CLAUDE_SKILL_DIR}/scripts/condense.sh ${CLAUDE_SESSION_ID} > <scratchpad>/report-transcript.md`. Done when the file exists and is not empty.

2. **Analyze with Sonnet.** Spawn one Agent with `model: "sonnet"`. It starts with no context, so pass:
   - the transcript path;
   - the user's note;
   - the rule files: `${CLAUDE_SKILL_DIR}/../proportionality/SKILL.md`, `${CLAUDE_SKILL_DIR}/../../plugin-agents/impact-review.md`, `${CLAUDE_SKILL_DIR}/../humanize/SKILL.md`, and `~/.claude/CLAUDE.md`;
   - this task and output format:

   > Find the turn where Claude went wrong, guided by the user's note. Read the turns before it to see why: which assumption, trigger, or shortcut led there. Then check the rule files: which rule should have caught it, and why it did not (the rule is missing, its wording is too weak, its trigger did not fire, or the skill was not loaded). Propose the smallest change that would have prevented it, written as a positive instruction. The repo is public: describe only the general pattern, as it could happen in any codebase, with no implementation details, code, code patterns, internal names, paths, or identifying numbers. This applies to the proposed change, too. Reply in exactly this format:
   >
   > ```markdown
   > **Title:** <skill or agent>: <the wrong turn, under 70 characters>
   > ## Case
   > <the abstracted situation and goal, 2–4 lines>
   > ## Wrong turn
   > <what Claude did, and what the user wanted instead, 2–4 lines>
   > ## Why
   > <the assumption or trigger behind it, 1–3 lines>
   > ## Rule check
   > <the rule that should have caught it, with file and quote, and why it did not — or "no rule covers this">
   > ## Proposed change
   > <file, section, and the new or changed wording; a new pattern row or example if that fits better>
   > ```

   Done when the reply follows the format, every section is filled, and the text reads as a general pattern with no implementation details or internal names. If it does not, send it back once with what is missing.

3. **Ask with the draft.** Show the user the complete title and body exactly as they would be published, and ask: "May I publish this issue on the public repo mars-mx/skills?" Wait for an explicit yes. On edits, apply them and ask again with the new draft. Without a yes, nothing is published.

4. **Create the issue.** Write the body to `<scratchpad>/report-issue.md`, append the line `Reported with /report.`, and run:

   ```sh
   gh issue create --repo mars-mx/skills --title "<title>" --body-file <scratchpad>/report-issue.md
   ```

   Give the user the issue URL.

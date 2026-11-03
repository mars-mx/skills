---
name: brainstorm
description: Brainstorm a problem with the user to find the best solution, read-only until the user gives a clear go. Researches the codebase with Haiku subagents, version-pinned official docs, and real data (logs, DB replicas), and backs every claim with a source. Run as /brainstorm <problem or question>.
disable-model-invocation: true
argument-hint: "<problem or question>"
---

# Brainstorm

You are a sparring partner. The goal is the best solution to the user's problem, not the first one that works, and a user who thinks the problem through more sharply than before. Stay open about the outcome: the simplest answer competes on equal terms with every other option and wins only on the criteria.

## Read-only until the go signal

The session stays **read-only** in every round: no repo edits, no commits, no branches, no writes to databases, clusters, issues, or any external system. Read, search, fetch, and run read-only commands and `SELECT` queries.

The **go signal** ends read-only mode. It is an explicit instruction to build: "setz das so um", "mach das", "implement it", "leg los". Agreement is no go signal: "klingt gut", "ok", "gefällt mir", "ja, Option B" keep the session in brainstorm mode. When you cannot tell, ask "Soll ich das umsetzen?" and wait. After the go signal, implement only what the signal covers.

## Sourced claims

Every factual statement in your answer is a **sourced claim**: it carries a `file:line`, a doc URL with the version, a query with its result, or a log excerpt. Knowledge from memory about frameworks, packages, tools, APIs, and their limits is outdated by default, so look each one up before you use it, even when you feel sure.

A statement you can check gets checked. The answer body states facts plainly, without hedges like "vermutlich", "sollte", "wahrscheinlich", or "nicht geprüft". A claim either has a source, moves to the `NICHT ÜBERPRÜFT:` section at the bottom, or gets dropped.

## Rounds

Work through these steps in the first round. Later rounds go back to the step the user's reply touches.

1. **Goal.** Restate the problem as the outcome the user needs, in one or two sentences. Check the premise: is the stated problem the real one, or a proposed solution to an unstated one? Treat the user's own factual claims ("this query is slow", "users never do X") as claims to check against code and data. Done when you can name the goal, the premise you checked, and what success looks like. If the problem has readings that would need different research, ask one or two questions about the goal and end the round there.
2. **Facts.** Gather what the decision depends on (see [Research](#research)). Done when every fact the options will rest on is a sourced claim or sits in `NICHT ÜBERPRÜFT:`.
3. **Options.** Lay out three to five genuinely different approaches: different mechanisms, not variations of one. Include changing the requirement and doing nothing where they are real options. For design questions, load `proportionality` and start from the ideal design before constraints.
4. **Criteria.** Name the criteria that decide this case (for example correctness, operating cost, coupling, reversibility, effort, risk) and say which ones weigh most and why. Judge each option against them with sourced claims.
5. **Recommendation.** Pick one option and say why it beats the runner-up. Name the evidence that would change the recommendation.
6. **Questions.** Ask the user two to four pointed questions: about their goal, a constraint only they know, or a weak spot in their own reasoning. Name the strongest counterargument to the option the user leans toward.

## Research

Delegate exploration to `Explore` subagents with `model: "haiku"`, several in one message when the questions are independent. `Explore` has no Edit or Write tools; its Bash is unrestricted, so every brief states: "Read-only. Run no command that changes files, git state, or any system." Each brief also requires verbatim quotes with `file:line` or URL for every finding.

A subagent's report is a set of claims. Before a claim carries weight in the recommendation, open the cited line or URL yourself and confirm it.

**Docs.** Read the installed version from the lockfile or the tool's `--version` first. Then use the official docs, changelog, or release notes for that exact version, or the installed source in `node_modules`, `site-packages`, or the module cache. Blog posts and forum answers give leads, not sources.

**Data.** Real data beats reasoning about data. Before you ask the user for access, search for it: `CLAUDE.md`, `README`, runbooks, `.env*`, `kubectl config get-contexts`, and the MCP tools (use ToolSearch, for example for logs, metrics, analytics, or the database). Use what is documented, read-only: `SELECT` on replicas, log and metric queries, `kubectl get` and `kubectl logs`. Bound every query with `LIMIT` or a time range. If only a production primary is reachable, ask before you query it. Ask the user only when no access is documented; name the exact data you need and why it decides the question.

## Answer format

This format replaces `humanize` while the session is in brainstorm mode. Write in the user's language.

Keep it **terse**: the whole answer fits on one screen. One line per fact, option, and question; the research stays in your context, only its conclusion reaches the user. Ask every question as plain text in the chat, numbered so the user can answer by number; the AskUserQuestion tool stays unused.

```markdown
**<Recommendation or the open question, in one line>**

**Goal:** <the real goal and the premise you checked>
**Facts:** <the sourced claims the decision rests on>
**Options:** <each option with its verdict against the criteria>
**Recommendation:** <the option, why it beats the runner-up, what would change it>
**Questions:** <the questions for the user>

NICHT ÜBERPRÜFT:
1. <statement> — <the source you need from the user>
```

Keep the header `NICHT ÜBERPRÜFT:` literal, in every language. An item belongs there only when checking it needs a source you cannot reach without the user: credentials, or data or a system with no documented access. Questions about the user's intent, business, or plans go into **Questions**. Each item names the missing source. Leave the section out when it is empty.

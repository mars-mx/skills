---
name: humanize
description: Decision-brief format for every message to the user in a long session. Use whenever you report a finished change, propose a plan or approach, ask the user to decide, or are about to add a fallback, workaround, retry, or compatibility shim.
---

# Humanize

The user is a senior developer running 10+ sessions in parallel. They know the repo's shape, not its function names. Each message you send is read cold, after a context switch, and has to support a decision in under a minute.

Write a **decision brief**: the headline tells what happened and what you need; the rest gives just enough context to decide. The user judges each change by its long-term cost, so that is what the brief makes visible.

## Pick the form

- **Yes/no or factual answer:** answer in the first line. No template.
- **Status update or plain question:** short form.
- **Finished change, proposed approach, or decision:** full form.

When you also publish an artifact (for example through `visual-output`), the chat message still opens with the brief and links the artifact below it.

## Short form

```markdown
**<Headline: what happened or what you ask, in one line>**
<Context: which goal this serves, one line.>
<One to three lines of substance. End with the question, if any.>
```

## Full form

```markdown
**<Headline: change + state + what you need from me. Readable without anything else.>**
Context: <the goal this serves, one line — the re-entry anchor after a context switch>

**Change:** <what now holds, at system level, 1–3 lines. Name a symbol only with what it is for.>
**Why this way:** <why it is the simplest durable fix; what it locks in; how hard it is to reverse>
**Added safety nets:** <every fallback, workaround, retry, compat shim, or special case you added, each with its reason and removal condition — or "none">

**Alternatives:**
- <option> → <why not, in long-term terms>
- <option> → <why not>

**Decision:** <one question with your recommendation — or "none, done">
```

Rules for the full form:

- The brief fits on one screen, about 15 lines. Cut evidence of effort; keep design decisions, contract changes, and consequences.
- Alternatives: up to three real ones, each judged by maintenance cost, coupling, and reversibility. A quicker hack you rejected counts as an alternative; say why it loses long term.
- **Added safety nets** is always present. "None" is a valid and welcome answer.
- Describe behavior, not files. A file or function appears only when the user has to look at it.

## Safety nets are decisions

The user's main risk is short-term reliability bought with long-term complexity. Before you add a fallback, workaround, retry, silent default, or compatibility path, put it to the user as the **Decision** instead of shipping it: name the root cause, the direct fix, and what the safety net would cost to carry. Ship the direct fix by default; add the safety net once the user approves it.

## Example

```markdown
**Webhook retries fixed at the source — no decision needed.**
Context: payment webhooks from Stripe were processed twice under load.

**Change:** The handler now records each event ID in a unique-keyed table before processing and skips IDs it has seen. Duplicates become a no-op.
**Why this way:** Idempotency belongs at the entry point; one table, one index, no new service. Reversible by dropping the check.
**Added safety nets:** none

**Alternatives:**
- In-memory dedupe cache → breaks with more than one replica and on restart.
- Retry with backoff on the duplicate-key error → hides the cause and adds a code path to maintain.

**Decision:** none, done.
```

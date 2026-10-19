# Gates

Every gate has a trigger, a checklist for the Sonnet gate check, and an example message. The verifier confirms a gate only when every checklist item holds; it answers each item with yes or no and the evidence it looked at.

## Message format

A red gate message is exactly this, in German, one Evidence item per line:

```
🔴 <gate id> <gate name> · <repo>#<issue>
Problem: <ein Satz Problem Statement>
Grund für Gate: <warum User-Feedback nötig ist>
Evidence:
- <command and result, file:line, URL, or screenshot path>
```

The ready message (G7) is:

```
🟢 G7 Bereit zum Merge · <repo>#<issue> → <PR URL>
Review nötig: <ja | nein> – <risk tier and the path or behavior that set it>
Evidence:
- <pr-status.mjs result>
- <verification commands and results>
- <review rounds and findings closed>
```

## G0 Preflight

**Trigger:** `gh` is not authenticated or cannot read the issue; the worktree is dirty; `pre-pr-review` or `ponytail:ponytail-review` is missing from the skill list; the repo has no automated Claude reviewer.

**Checklist:**
- [ ] The failing check was run in this session, and its output is in Evidence.
- [ ] The failure is not fixable by the agent without the user (a login, an install the user must approve, the user's uncommitted work, a repo setting).
- [ ] For a missing skill: the skill list was checked by its exact name, including the plugin prefix.
- [ ] For a missing reviewer: `.github/workflows/` was searched and the last 10 merged PRs were checked for bot reviews.

**Example:**

```
🔴 G0 Preflight · acme/web#412
Problem: Das Repo hat keinen automatisierten Claude Code Review, auf den der PR-Watcher warten kann.
Grund für Gate: Ohne Reviewer kann Schritt 8 nie grün werden; den Reviewer einzurichten ist eine Repo-Einstellung, die du entscheidest (z. B. per /review-setup).
Evidence:
- grep -rl "claude-code-action\|claude-code-security-review" .github/workflows → keine Treffer
- gh pr list --state merged -L 10 --json reviews → 0 Bot-Reviews
```

## G1 Assumptions

**Trigger:** any one of these holds after the plan review:
- An open question whose possible answers lead to materially different work, and that the issue, the code, the docs, and the git history cannot settle.
- The only fix within the issue's scope is a workaround, and the long-term fix needs extensive changes: a schema migration, a public API change, a cross-module refactor, or a new dependency.
- The issue contradicts the code, another issue, or a documented decision.

**Checklist:**
- [ ] The question or conflict is stated in one sentence and appears in `plan.md`.
- [ ] Evidence names every source searched for an answer: the issue thread, the files, the docs, the `git log` query.
- [ ] The options lead to different work: the verifier can name a file or behavior that differs between them.
- [ ] For a workaround: the extensive long-term change is named concretely (which migration, which API, which modules), not as a guess.
- [ ] The plan review ran its rounds for the complexity, and its findings are in Evidence.

**Example:**

```
🔴 G1 Annahmen · acme/web#412
Problem: Das Issue verlangt Rabatte pro Kunde, das Preismodell kennt aber nur Rabatte pro Produkt.
Grund für Gate: Die saubere Lösung braucht eine Schema-Migration (customer_discounts); der Workaround über Produkt-Rabatte bricht bei Kunden mit mehreren Verträgen. Das ist eine Produktentscheidung.
Evidence:
- prisma/schema.prisma:L88-104: Discount hängt nur an productId
- Issue #412, Kommentar 3: "pro Kunde, nicht pro Produkt"
- Plan-Review Runde 2: Annahme A3 als workaround eingestuft, Long-term-Fix = Migration + 4 betroffene Services
```

## G2 Environment

**Trigger:** a baseline command fails on the unchanged branch, or a planned harness (Playwright browsers, test database, E2E stack) does not start; or a category has no tests and no valid skip reason.

**Checklist:**
- [ ] The baseline ran on the unchanged branch, before any implementation commit.
- [ ] The exact command and the failing part of its output are in Evidence.
- [ ] The failure comes from the environment or the base branch, not from a change in this run (`git status` and `git log <default>..HEAD` are empty).
- [ ] One documented setup step (README, `CLAUDE.md`, `package.json` scripts) was tried and is in Evidence, or there is none.
- [ ] No category is skipped for an environment reason.

**Example:**

```
🔴 G2 Environment · acme/web#412
Problem: Die Playwright-Suite startet auf dem unveränderten main nicht, weil die Test-Datenbank fehlt.
Grund für Gate: Das Issue ändert den Checkout-Screen, also sind Playwright-Tests Pflicht; das Environment reparieren liegt bei dir. Run beendet.
Evidence:
- pnpm test:e2e → Error: connect ECONNREFUSED 127.0.0.1:5433
- pnpm db:test:up (aus README) → docker: Cannot connect to the Docker daemon
- git log main..HEAD → leer
```

## G3 Implementation review

**Trigger:** the third review round still returns new Must fix or Should fix findings.

**Checklist:**
- [ ] Three rounds ran, and each round's findings are listed with file and line.
- [ ] The findings that keep coming back are named, with the round each appeared in.
- [ ] Every earlier finding was fixed or recorded as not applicable with a reason.
- [ ] The remaining findings are not plain fix tasks a fix brief could close in one round.

**Example:**

```
🔴 G3 Implementation Review · acme/web#412
Problem: Der Review findet nach 3 Runden weiter Race Conditions im neuen Rabatt-Cache.
Grund für Gate: Die Findings kommen aus dem Ansatz (prozesslokaler Cache bei mehreren Workern), nicht aus einzelnen Zeilen; ein anderer Ansatz ändert den Plan.
Evidence:
- Runde 1: src/pricing/cache.ts:L22 check-then-write
- Runde 2: src/pricing/cache.ts:L41 stale read nach Invalidation
- Runde 3: src/pricing/cache.ts:L58 Worker teilen keinen State
```

## G4 Verification

**Trigger:** after 3 fix rounds, a planned test, typecheck, lint, or build is still red; or a UI screenshot still contradicts the issue or the spec.

**Checklist:**
- [ ] The last run of each red command is in Evidence, with the failing test name and assertion.
- [ ] The same command was green in the baseline, so the failure comes from this change.
- [ ] Each round's diagnosis and fix is listed.
- [ ] No test was weakened, skipped, or deleted to get green.

**Example:**

```
🔴 G4 Verifikation · acme/web#412
Problem: Der Unit-Test für Rabatt-Rundung bleibt nach 3 Runden rot.
Grund für Gate: Akzeptanzkriterium 2 (kaufmännisch runden) widerspricht der bestehenden Rundung in invoice.ts, die Rechnungen nutzen; eine der beiden muss sich ändern.
Evidence:
- pnpm vitest discount.test.ts → expected 10.05, received 10.04
- Baseline: pnpm vitest → grün
- src/billing/invoice.ts:L31 rundet ab (Math.floor)
```

## G5 Pre-PR review

**Trigger:** the `pre-pr-review` skill is not available, or it reports "blocked".

**Checklist:**
- [ ] For a missing skill: the skill list was checked for `pre-pr-review` by its exact name.
- [ ] For "blocked": the skill's report is quoted, with the open findings and their file and line.
- [ ] The blocking findings were not closed by the round cap of `pre-pr-review` itself.

**Example:**

```
🔴 G5 Pre-PR Review · acme/web#412
Problem: Der Skill pre-pr-review ist in dieser Session nicht verfügbar.
Grund für Gate: Ohne pre-pr-review gibt es keinen Risk Tier und keinen PR-Body; der Flow stoppt hier.
Evidence:
- Skill-Liste geprüft: kein Eintrag "pre-pr-review" (auch nicht mit Plugin-Präfix)
- Installation: /plugin install review-skills@mars-skills
```

## G6 PR loop

**Trigger:** after 3 rounds, CI is still red or the Claude reviewer still raises new findings; the watcher timed out; or merging the default branch gives a conflict without one clear answer.

**Checklist:**
- [ ] The latest `pr-status.mjs` JSON is in Evidence.
- [ ] For red CI: the failed job log was read, and the failure is not a flaky test that passed on rerun (`gh run rerun --failed` was tried once).
- [ ] For a timeout: the pending check names are listed, and the run page was opened.
- [ ] For a conflict: the conflicting files and both sides' intent are named.
- [ ] Each round's fixes are listed with their commits.

**Example:**

```
🔴 G6 PR-Loop · acme/web#412
Problem: Der Check "deploy-preview" hängt seit 60 Minuten auf pending.
Grund für Gate: Der Check läuft auf einer externen Plattform, die der Agent nicht neu starten kann.
Evidence:
- pr-status.mjs 418 → checks.pending: ["deploy-preview"], timedOut: true
- https://github.com/acme/web/pull/418/checks → "Waiting for runner"
```

## G7 Ready

**Trigger:** `pr-status.mjs <pr>` reports `ready: true`.

**Checklist:**
- [ ] `ready: true` in a `pr-status.mjs` run made after the last push: no pending or failing check, `mergeStateStatus` is `CLEAN` (or `BLOCKED` with `awaitingApproval: true`, meaning only the human approval is missing), `behindBy` is 0, no unresolved thread, not a draft.
- [ ] The Claude reviewer ran on the head commit, and its last round raised nothing new.
- [ ] Every category in `verification.md` ran green or carries a valid skip reason.
- [ ] "Review nötig" matches the risk tier from `pre-pr-review`: `Low` no, `Medium` and `High` yes.
- [ ] The PR body has Summary, Testing, Risk, How to revert, Review, and Decisions.

**Example:**

```
🟢 G7 Bereit zum Merge · acme/web#412 → https://github.com/acme/web/pull/418
Review nötig: ja – Medium: ändert die Preisberechnung im Checkout
Evidence:
- pr-status.mjs 418 → ready: true, 14 Checks grün, behindBy 0, 0 offene Threads
- Playwright 6/6, Unit 23/23 grün; E2E übersprungen: keine Service-Grenze betroffen
- Implementation Review: 2 Runden, 5 Findings gefixt; Claude Review: 1 Runde, 2 Findings gefixt
- Screenshots: /tmp/issue-to-pr/web-412/screenshots/
```

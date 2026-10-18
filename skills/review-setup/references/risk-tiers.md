# Risk tiers template

Fill this for the target repo and save it as `docs/risk-tiers.md`. Replace every `<...>` with real paths.

```markdown
# Risk tiers

The change sets the tier, not the author. Classify by the most sensitive path the diff touches and by what the change does.

| Tier | Examples | Human approvals |
|---|---|---|
| Low | Docs, copy, tests, internal-only features, additive changes behind a flag | None once CI, AI review, and security review are green |
| Medium | Ordinary product changes; sensitive areas: <caching, prompts, ...> | One person |
| High | Always-human paths below, schema migrations, public API changes | Two people |

## Always-human paths

A person reviews any change here, whatever its tier:

- `.github/workflows/` and every other CI or release config
- <auth paths>
- <billing / payments paths>
- <installer, auto-updater, deploy scripts>
- <secrets handling>

## Rules

- Only trusted authors (the owning team, listed in `CODEOWNERS`) get the Low path. Everyone else needs one person.
- Bot approvals never fill a human approval slot.
- On an agent-written PR, the person who directed the agent counts as a reviewer, as if they typed the code.
- Approvals apply per commit. A new commit nobody vouched for, such as an agent push or a hand-resolved merge, needs re-approval.
- Start strict. Move a path down a tier only with evidence: a run of clean merges and no reverts.
```

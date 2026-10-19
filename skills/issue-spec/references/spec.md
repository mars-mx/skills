# Spec format

The issue body. `issue-to-pr` reads these headings by name, so keep them in English and in this order; write the content in the issue's language. Leave out a section only where this file says so.

```markdown
## Problem
<Who has which problem today, in two or three sentences.>

## Goal
<What holds after the PR, in one sentence.>

## Acceptance criteria
1. <Testable: a test can pass or fail on it.>
2. ...

## Out of scope
- <What this PR does not do, and where it goes instead (issue link) if anywhere.>

## Decisions
| Decision | Reason | Kind | Source |
| --- | --- | --- | --- |
| <what was decided> | <why> | long-term \| workaround: <the long-term change it postpones> | user \| <file:line, comment URL> |

## Verification
- **Playwright:** <test file: what it asserts (AC n)> | skip: <reason that describes the change>
- **Unit:** <...> | skip: <...>
- **E2E:** <...> | skip: <...>

## UI spec
Leave out when the change touches no UI.
- **Design artifact:** <URL>
- **Spec story:** `src/specs/<issue>-<slug>.spec.stories.tsx`, title `Specs/#<issue> <title>`
- **Screens and states:** <screen: default, loading, empty, error, ...>
- **Viewports:** <from ux.config.json, desktop first, e.g. 1440, 390>
- **Approved additions:** <component: tier (extend | new), reason no catalog component fits> | none

## Complexity
<S | M | L>: <reason: areas touched, contract changes>

## Affected areas
- `<path>`: <what changes there>

## Related
Leave out when there is nothing to link.
- Depends on #<n> / Part of a split with #<n>, #<n>
```

A skip reason describes the change ("the change touches no UI", "no service boundary is crossed"). The environment is never a skip reason.

`Affected areas` names paths, not slices: `issue-to-pr` cuts the slices.

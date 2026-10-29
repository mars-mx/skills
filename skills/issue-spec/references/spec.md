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
- <What this PR does not do, and where it goes instead (issue link) if anywhere. For a need of a later step: the addition it will fit in as (a new consumer, table, field, or event type).>

## Edge cases
Leave out when there is none.
| Case | Affected | Cost if wrong | Response |
| --- | --- | --- | --- |
| <the edge case> | <N of M, how often> | <what a wrong result costs there> | accept and mark: <the marker> \| contain: <where> \| redesign: <why the main design changes> |

## Decisions
| Decision | Reason | Kind | Source |
| --- | --- | --- | --- |
| <what was decided> | <why> | long-term \| workaround: <the long-term change it postpones> | user \| <file:line, comment URL> |

## Assumptions
Leave out when there is none.
| Assumption | Evidence | Kind | If wrong |
| --- | --- | --- | --- |
| <what the spec takes as given> | user \| <file:line, doc, comment URL> | long-term \| workaround: <the long-term change it postpones> | <what breaks, or which work changes> |

## Contracts and data model
- **Review artifact:** <URL> | skip: complexity S, no contract or data model change
- **Contracts:** per changed contract, `<layer>: <name>` (`<file:line>`): <before → after>, breaking \| additive, consumers: <paths> | none
- **Data model:** per changed entity, `<entity>` (`<file:line>`): <fields added, changed, removed>; migration: <steps, backfill, rollback> | none

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

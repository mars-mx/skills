# REVIEW.md template

Fill this for the target repo. Replace every `<...>`; delete guidance lines in italics.

```markdown
# Review guide

Read the diff against the whole repo and the PR's stated intent. Ask whether the change solves its problem, fits the system, and leaves everything else working. On a bug fix, find the root cause.

## What failure looks like

_One section per area. State the failure in the area's own terms, the way "docs: it lies" or "config: it misroutes" does._

### <area, e.g. API handlers> (`<path/>`)
- <failure, e.g. "a handler returns 200 on a partial write">
- <failure>

## Evidence

Every finding cites a file and line in this repo, plus the input or state that triggers it. A finding drawn from a name or a guess about code you have not read is dropped.

## Severity

Tag each finding:
- **Important**: wrong behavior, data loss, security, or a broken contract.
- **Nit**: style or readability. At most <3> nits per review.
- **Pre-existing**: a bug the diff did not introduce. Never blame the author for it.

Style that a linter or formatter could catch goes into that tool's config, not into a comment.

## Skip

- <generated code path>
- <lockfiles, vendored code, snapshots>

## Summary

Start the summary with the count of Important findings. When there is nothing to fix, say so in one line.

## Re-review

After round 1, review only the new diff. Never repeat a finding already posted. When a bug belongs to a class, name the class so the author fixes every instance. After 3 rounds, ask the author to reconsider the approach instead of reviewing again.
```

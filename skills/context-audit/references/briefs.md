# Subagent briefs

Fill in the `<placeholders>`. The brief ends with the exact return format; ask for nothing else, so the reply stays short.

## Pattern finder (Haiku)

```
Find patterns of wasted context in a batch of Claude Code tool calls. Read only the file named;
search nothing, change nothing.

Batch: <RUN_DIR>/batches/<NN>.json
Each call has: id, tool, input (what was asked), tokens (result size), remaining (requests the
result stayed in context), carried (tokens x remaining), project, subagent, error, excerpt (start
and end of the result).

Look for repeated shapes, not single calls. Examples of patterns:
- a whole large file read where the excerpt shows only a small part was needed
- the same file, command, or URL repeated across calls
- output full of noise: progress bars, lockfile or generated code, base64, full JSON where a few
  fields were enough, long diffs, full test logs, HTML
- a result that is mostly an error, a usage text, or a retry of an earlier call
- exploration that a subagent could have done (many greps and reads in a row)
- a large result early in a long session (high remaining)

Do no arithmetic; the orchestrator sums the ids. Return at most 6 patterns, largest first, one block each:
### <short name>
ids: <every matching call id, full, comma-separated>
cause: <one line: why the output was large or repeated>
fix: <one concrete change: the narrower command, offset/limit, a filter hook, a CLI instead of
the MCP tool, delegate to a subagent, or a CLAUDE.md line>
Return "none" if no pattern covers 3 or more calls.
```

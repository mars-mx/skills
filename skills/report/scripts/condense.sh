#!/bin/sh
# Prints a session transcript as readable Markdown: user and assistant text, tool calls, and tool results cut to 300 characters.
# Usage: condense.sh <session-id>
f=$(find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" -name "$1.jsonl" | head -1)
[ -n "$f" ] || { echo "no transcript for session $1" >&2; exit 1; }
jq -r 'select(.type=="user" or .type=="assistant") | .type as $t
  | (if (.message.content|type)=="string" then [{type:"text",text:.message.content}] else .message.content end)[]
  | if .type=="text" then "\n## \($t)\n\(.text)"
    elif .type=="tool_use" then "[tool \(.name)] \(.input|tostring|.[0:300])"
    elif .type=="tool_result" then "[result] \(.content|tostring|.[0:300])"
    else empty end' "$f"

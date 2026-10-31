# Best practices

Each source backs one or more checks. Append `.md` to a `code.claude.com` URL to get plain text, and grep it for the fact you need.

| Source | Backs |
| --- | --- |
| [Claude Code best practices](https://code.claude.com/docs/en/best-practices) | `/clear` between tasks, subagents for exploration, short CLAUDE.md |
| [Manage costs and reduce token usage](https://code.claude.com/docs/en/costs) | `/context`, deferred MCP tools, CLI over MCP, filter hooks, CLAUDE.md under 200 lines, workflows in skills |
| [Memory: CLAUDE.md and auto memory](https://code.claude.com/docs/en/memory) | 200-line target, path-scoped rules, imports cost the same, auto memory loads the first 200 lines or 25KB of `MEMORY.md`, `autoMemoryEnabled`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY` |
| [MCP in Claude Code](https://code.claude.com/docs/en/mcp) | tool search and deferral, scopes (user, local, project), disabling servers |
| [Skills in Claude Code](https://code.claude.com/docs/en/skills) | descriptions load always, bodies on demand, `disable-model-invocation` |
| [Agent Skills best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices) | concise SKILL.md, progressive disclosure through references, scripts over generated code |
| [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | token-efficient tool responses, pagination and filtering, concise response formats |
| [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | context as a finite budget, context rot, compaction, subagents with clean context |

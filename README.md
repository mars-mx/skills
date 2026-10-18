# Skills

A collection of custom skills for Claude Code.

## Skills

| Skill | Invocation | Purpose |
| --- | --- | --- |
| `ux-design` | automatic on UI work | Catalog-first UI on shadcn/ui. Gates on the shadcn MCP and skill, records project decisions in `ux.config.json`, and enforces go/no-go rules. |
| `ux-audit` | `/ux-audit` only | Scans the codebase with Haiku reviewers, summarizes violations with Opus, and offers fixes. |

Install with `/plugin install ux-skills@mars-skills`. When you copy the skills manually, copy both folders side by side: `ux-audit` reads the rules and scripts from `../ux-design`.

## Installation

### Claude Code

Register this repository as a plugin marketplace:

```
/plugin marketplace add mars-mx/skills
```

Then install a plugin from it:

```
/plugin install <plugin-name>@mars-skills
```

### Manual

Copy any skill folder into `~/.claude/skills/` to make it available in all projects.

## Creating New Skills

Use the `template/` directory as a starting point. Each skill needs a `SKILL.md` file with YAML frontmatter (`name` and `description`) and markdown instructions.

# Skills

A collection of custom skills for Claude Code.

## Skills

### ux-skills

Catalog-first UI on shadcn/ui: every page is built from one component catalog (shadcn components plus the project's own, documented in Storybook) instead of one-off markup.

| Skill | Invocation | Purpose |
| --- | --- | --- |
| `ux-design` | automatic on UI work | Runs a preflight gate, records project decisions in `ux.config.json`, maps each UI change to catalog components in a Claude Design artifact, applies go/no-go rules with an approval ladder (reuse, then extend, then new component), and verifies the result with browser screenshots against the spec. |
| `ux-audit` | `/ux-audit` only | Reviews the codebase with Haiku subagents, summarizes violations with Opus, and fixes approved findings with Haiku. |

**Requirements.** The preflight stops UI work until these are in place, and offers to install what is missing:

- a shadcn project (`components.json`)
- the official shadcn skill (`npx skills add shadcn/ui --skill shadcn -y`)
- the official shadcn MCP server (`npx shadcn@latest mcp init --client claude`, then restart the session)
- `ux.config.json`, created once with you: motion mechanism (`motion` or CSS keyframes), catalog folders, and approved exceptions

Storybook is recommended; a missing Storybook only produces a warning. Node.js runs the scripts.

**Scripts** in `skills/ux-design/scripts/`, run from the project root:

| Script | Purpose |
| --- | --- |
| `preflight.mjs` | Checks the requirements. Exits 1 on a failed gate. |
| `install.mjs [root] [check-id ...]` | Runs the install command for failed checks. |
| `scan.mjs [root] [--files ...]` | Prints rule violation candidates as JSON lines. |

The rules with go/no-go examples live in `skills/ux-design/references/rules.md`.

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

Copy any skill folder into `~/.claude/skills/` to make it available in all projects. Copy `ux-audit` together with `ux-design`: it reads the rules and scripts from `../ux-design`.

## Creating New Skills

Use the `template/` directory as a starting point. Each skill needs a `SKILL.md` file with YAML frontmatter (`name` and `description`) and markdown instructions.

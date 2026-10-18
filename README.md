# Skills

A collection of custom skills for Claude Code.

## Skills

_No skills yet._

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

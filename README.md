# Skills

A collection of custom skills for Claude Code.

## Skills

- **[wireframe](./skills/wireframe)** — Create UI wireframes using the Wireweave DSL, a compact text format that renders to SVG. Supports component annotations for design specs.

## Installation

### Claude Code

Register this repository as a plugin marketplace:

```
/plugin marketplace add <owner>/<repo>
```

Then install:

```
/plugin install wireframe-skills@mars-skills
```

### Manual

Copy any skill folder into `~/.claude/skills/` to make it available in all projects.

## Creating New Skills

Use the `template/` directory as a starting point. Each skill needs a `SKILL.md` file with YAML frontmatter (`name` and `description`) and markdown instructions.

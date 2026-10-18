---
name: ux-design
description: Catalog-first UI building on shadcn/ui. Use for any UI change in a project with a components.json - new pages, layouts, forms, dialogs, tables, styling, animations, or adding and changing components.
---

# UX design: catalog first

Every UI is assembled from the **catalog**: shadcn components plus the project's own components, documented in Storybook. Feature code composes catalog components; the catalog owns look and behavior. The rules with go/no-go examples live in [references/rules.md](references/rules.md). Read it before writing UI code.

## 1. Preflight (hard gate)

Run from the project root:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/preflight.mjs
```

The step is done when the script exits 0 **and** the `mcp__shadcn__*` tools are in your tool list. A configured server whose tools are missing needs a session restart.

On any `FAIL`, stop UI work. Show the failed checks and ask the user whether to install them. On yes, run:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/install.mjs . <check-id> ...
```

then run the preflight again. A `FAIL decision` is resolved in step 2, not by the installer. A `WARN storybook` does not block; offer the install once and continue with the catalog paths if the user declines.

## 2. Project decisions

`ux.config.json` in the project root is the single source of truth for project-wide UX decisions. It is committed with the code.

```json
{
  "motion": "motion",
  "catalog": ["src/components/ui", "src/components/catalog"],
  "exceptions": [
    {
      "file": "src/app/legacy/page.tsx",
      "rule": "UX-C2",
      "reason": "Third-party embed needs a native input",
      "approvedAt": "2026-10-18"
    }
  ]
}
```

- `motion`: `"motion"` (the `motion/react` library) or `"css"` (CSS keyframes and transitions). Rule UX-M1 says what each allows.
- `catalog`: folders that hold catalog components. Everything outside is feature code.
- `exceptions`: deviations the user approved, one entry per file and rule. The audit and the scanner skip them.

If the file is missing, decide once with the user:

1. Ask with AskUserQuestion: motion library or CSS keyframes. Name the trade-off: `motion` gives spring physics, layout and exit animations, and gestures at a bundle cost (about 34 KB for the full `motion` component, less with `LazyMotion`); CSS costs nothing at runtime and covers enter, hover, and press effects.
2. Detect the catalog folders (the `ui` alias in `components.json`, plus folders with `*.stories.tsx`) and confirm them with the user.
3. Write `ux.config.json`. Add this pointer to the project's `CLAUDE.md` or `AGENTS.md`, so sessions without this skill see the decision:

   ```markdown
   ## UI
   UI follows the catalog-first rules of the ux-design skill. Project decisions (motion mechanism, catalog paths, approved exceptions) live in ux.config.json.
   ```

4. Run the preflight again.

The decision changes only when the user asks to change it. A change of mechanism is a migration: run `/ux-audit` afterwards.

## 3. Build from the catalog

For every piece of UI, walk the escalation ladder and take the first tier that fits:

1. **reuse**: an existing catalog component or variant. Search `*.stories.tsx` and the catalog folders, then the shadcn registry with `mcp__shadcn__search_items_in_registries`. A missing official shadcn component is added with `shadcn add` into the catalog, with a story.
2. **extend**: a new variant or prop on a catalog component, or a wrapper around one.
3. **new**: a new catalog component, only when tiers 1 and 2 cannot express it.

Tiers 2 and 3, raw HTML primitives, and every other deviation from the rules need the user's explicit approval. Before asking, stop and state the gap: what is missing, where it is needed, which catalog or shadcn component comes closest, and which tier you propose. Until the user approves, build with the closest existing component.

After approval:

- **extend** and **new** land in the catalog folders, with a story that shows every variant and state (default, hover, focus, disabled, loading, error, empty, reduced motion).
- An approved deviation in feature code gets an entry in `ux.config.json` → `exceptions`.

## 4. Done

The UI change is done when:

- the scanner reports zero hits for the files you touched:

  ```bash
  node ${CLAUDE_SKILL_DIR}/scripts/scan.mjs . --files <changed files>
  ```

  Each remaining hit is either fixed or judged a false positive against `references/rules.md`, and you name it in your reply.
- every catalog component you added or changed has its story, and you opened each story once (all variants, keyboard, narrow width, reduced motion).
- typecheck and lint pass.

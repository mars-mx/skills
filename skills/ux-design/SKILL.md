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
  "viewports": [1440, 390],
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
- `viewports`: the widths in px that specs are drawn at and screenshots are taken at, desktop first. Desktop is the primary comparison. Missing means `[1440, 390]`.
- `exceptions`: deviations the user approved, one entry per file and rule. The audit and the scanner skip them.

If the file is missing, decide once with the user:

1. Ask with AskUserQuestion: motion library or CSS keyframes. Name the trade-off: `motion` gives spring physics, layout and exit animations, and gestures at a bundle cost (about 34 KB for the full `motion` component, less with `LazyMotion`); CSS costs nothing at runtime and covers enter, hover, and press effects.
2. Detect the catalog folders (the `ui` alias in `components.json`, plus folders with `*.stories.tsx`) and confirm them with the user.
3. Write `ux.config.json`.
4. Run the preflight again.

The decision changes only when the user asks to change it. A change of mechanism is a migration: run `/ux-audit` afterwards.

## 3. Design spec

Every UI change starts from a **design spec**: the expected result that step 5 verifies against. A spec the user gave (mockup, screenshot, Figma frame, written description) is used as is.

Without one, spawn a `general-purpose` subagent to create it as a **Claude Design artifact**, so the catalog search stays out of your context. Give it the user's request, the catalog paths from `ux.config.json`, the Storybook URL, and these instructions:

> Find the Design artifact type with the Artifact tool (`action: "quickstart"`, `intent: "design"`), create the artifact from its `type_url` with the title `<feature> spec`, and follow the type's instructions to fill it. Draw one artboard per screen of the change, at each width in `viewports`, built to look like the project's catalog components (use their Storybook stories as reference). Annotate every region with its catalog component, variant, props, and story (`*.stories.tsx` file and story name). Add one artboard per state: loading, empty, error, disabled. Put every component to add or extend on a separate "Additions" artboard, marked with its tier and the reason no existing component fits. You are done when every region maps to a story or to a marked addition. Reply with the artifact URL.

With Storybook and an issue number, add to the instructions:

> Also write the **spec story** `src/specs/<issue>-<slug>.spec.stories.tsx` with the title `Specs/#<issue> <title>`: one story per screen and state of the artifact, named `<Screen><State>` after them (for example `CheckoutDefault`), composed only of catalog components with static mock data, wrapped in the decorators of `.storybook/preview`. An addition renders as a placeholder box with a dashed border, labeled with the addition's name and tier. Take a screenshot of every story at each width in `viewports` and compare it with its artboard. You are done when every artboard has a story that matches it and the repo's typecheck and lint pass. Reply with the artifact URL and the story path.

Open the artifact for the user (`Artifact`, `action: "open"`), and the spec story in the running Storybook. Their confirmation approves the listed additions for step 4; build only after it.

**Spec mode.** When the `issue-spec` skill invokes this skill, stop after step 3 and return the artifact URL, the spec story path, and the approved additions. `issue-to-pr` builds and verifies later.

## 4. Build from the catalog

The shadcn skill's Critical Rules (styling, forms, composition, icons, base vs radix) apply to all code, catalog and feature code alike. This skill adds catalog governance on top; it does not repeat them.

For every piece of UI, walk the escalation ladder and take the first tier that fits:

1. **reuse**: an existing catalog component or variant. Search `*.stories.tsx` and the catalog folders, then the shadcn registry with `mcp__shadcn__search_items_in_registries`. A missing official shadcn component is added with `shadcn add` into the catalog, with a story.
2. **extend**: a new variant or prop on a catalog component, or a wrapper around one. Theme changes count here too: a new or changed token in the global stylesheet, defined as the shadcn customization guide describes (`name` / `name-foreground` pairs, light and dark values).
3. **new**: a new catalog component, only when tiers 1 and 2 cannot express it.

Tiers 2 and 3, raw HTML primitives, and every other deviation from the rules need the user's explicit approval. Before asking, stop and state the gap: what is missing, where it is needed, which catalog or shadcn component comes closest, and which tier you propose. Until the user approves, build with the closest existing component. Additions the user approved in the spec (step 3) need no second approval.

Catalog components are project source. Pulling upstream changes into one (`shadcn add --overwrite`, preset `apply`) also changes the catalog: show the `--diff` first and overwrite only after approval.

After approval:

- **extend** and **new** land in the catalog folders, with a story that shows every variant and state (default, hover, focus, disabled, loading, error, empty, reduced motion).
- An approved deviation in feature code gets an entry in `ux.config.json` → `exceptions`.

## 5. Verify

Open the changed screens in the browser (Claude in Chrome or Playwright, whichever the session has) and screenshot every region and state from the spec, at each width in `viewports`. Compare each screenshot with the spec: the spec story's screenshot at the same width where one exists, otherwise the Design artifact (open it in the browser next to the app). A placeholder region of the spec story is compared with its artboard:

- the component in each region is the one the spec names, in the named variant
- it looks like its artboard or the user's mockup: spacing, alignment, color, typography
- every listed state renders

Fix each mismatch and screenshot again. The step is done when every region and state matches, or the remaining differences are listed for the user with their screenshots.

## 6. Done

The UI change is done when:

- step 5 passed.

- the scanner reports zero hits for the files you touched:

  ```bash
  node ${CLAUDE_SKILL_DIR}/scripts/scan.mjs . --files <changed files>
  ```

  Each remaining hit is either fixed or judged a false positive against `references/rules.md`, and you name it in your reply.
- every catalog component you added or changed has its story, and you opened each story once (all variants, keyboard, narrow width, reduced motion).
- typecheck and lint pass.

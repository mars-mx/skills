# UX rules

Every rule has a stable ID. Findings, scan hits, and `ux.config.json` exceptions refer to these IDs.

**Catalog** means the project's component catalog: shadcn components plus the project's own components, both under the paths in `ux.config.json` → `catalog` and shown in Storybook. **Feature code** is everything else: pages, routes, layouts, feature modules.

Each rule names a **fix tier**, the escalation ladder from `SKILL.md`:

1. **reuse**: swap in an existing catalog or shadcn component. No approval needed.
2. **extend**: add a variant or prop to a catalog component, or wrap it. Needs user approval.
3. **new**: add a new catalog component. Needs user approval.

| ID | Rule | Severity | Typical tier |
| --- | --- | --- | --- |
| UX-C1 | Feature code reuses a catalog component when one fits | high | reuse |
| UX-C2 | Feature code renders catalog components, never raw interactive HTML | high | reuse |
| UX-C3 | Only the catalog imports primitive libraries | high | extend |
| UX-C4 | Feature code positions catalog components; the catalog styles them | medium | extend |
| UX-C5 | Reusable UI lives in the catalog, not inside a page file | medium | new |
| UX-C6 | Code follows the shadcn skill's Critical Rules | medium | reuse |
| UX-T1 | Colors come from theme tokens | medium | reuse |
| UX-T2 | Spacing and sizing use the Tailwind scale | low | reuse |
| UX-T3 | Styling goes through classes and variants | low | reuse |
| UX-M1 | Animation uses the mechanism recorded in `ux.config.json` | high | extend |
| UX-M2 | Animation lives inside catalog components | medium | extend |

## UX-C1: Reuse the catalog

Search Storybook stories and the catalog paths first, then the shadcn registry through the shadcn MCP. Build only from what you find.

```tsx
// GO: the catalog already has a confirm pattern
<ConfirmDialog title="Delete project?" onConfirm={remove} />

// NO-GO: a hand-built confirm flow from Dialog parts on the page
<Dialog open={open}>
  <DialogContent>
    <p>Delete project?</p>
    <Button onClick={remove}>Yes</Button>
  </DialogContent>
</Dialog>
```

## UX-C2: No raw interactive HTML in feature code

`button`, `input`, `select`, `textarea`, `dialog`, `table`, and `label` always come from the catalog, and `hr` becomes `Separator`. Layout elements (`div`, `section`, `main`, `ul`) are fine.

```tsx
// GO
<Button variant="outline" onClick={save}>Save</Button>
<Input type="email" {...field} />

// NO-GO
<button className="rounded border px-3 py-1" onClick={save}>Save</button>
<input type="email" className="border p-2" {...field} />
```

## UX-C3: Primitive libraries stay in the catalog

Radix, Base UI, vaul, cmdk, and react-day-picker are building blocks of catalog components. Feature code imports the catalog component.

```tsx
// GO
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// NO-GO
import * as Popover from "@radix-ui/react-popover";
```

## UX-C4: Position in feature code, style in the catalog

Feature code may pass layout classes: margin, grid and flex placement, width, `hidden`/responsive visibility. Visual classes (color, border, radius, shadow, font, padding inside the component) belong in a catalog variant.

```tsx
// GO: layout only, look comes from a variant
<Card className="col-span-2">...</Card>
<Button variant="destructive" size="sm" className="ml-auto">Delete</Button>

// NO-GO: restyling the component inline
<Card className="rounded-2xl border-2 border-primary bg-muted/50 p-8 shadow-xl">...</Card>
```

Fix tier: extend. Add a `variant` to the catalog component, then use it.

## UX-C5: No page-local components

A styled helper component defined inside a page file is a hidden catalog entry. Compose it from catalog components, or promote it to the catalog with a story.

```tsx
// GO: src/components/catalog/stat-tile.tsx with stat-tile.stories.tsx
<StatTile label="Revenue" value={revenue} />

// NO-GO: inside app/dashboard/page.tsx
function StatBox({ label, value }) {
  return <div className="rounded-lg border p-4"><span className="text-xs">{label}</span>{value}</div>;
}
```

## UX-C6: shadcn Critical Rules

The shadcn skill's Critical Rules hold everywhere. The scanner flags the ones a pattern can find; review catches the rest (missing `DialogTitle`, items outside their Group, incomplete Card structure).

```tsx
// GO
<div className="flex flex-col gap-4">
<Button disabled={pending}>{pending && <Spinner data-icon="inline-start" />}Save</Button>
<Skeleton className="h-4 w-32" />

// NO-GO
<div className="space-y-4">
<Button isLoading={pending}>Save</Button>
<DialogContent className="z-50">
<div className="h-4 w-32 animate-pulse rounded bg-muted" />
```

## UX-T1: Theme tokens for color

Use the semantic tokens from the shadcn theme: `bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`, and so on. The rule applies to feature code. Stock shadcn components ship a few literal colors (`text-white` on destructive variants, `bg-black/50` overlays); leave those as upstream wrote them.

```tsx
// GO
<p className="text-muted-foreground">...</p>

// NO-GO
<p className="text-gray-500">...</p>
<p className="text-foreground dark:text-zinc-100">...</p>
<p style={{ color: "#6b7280" }}>...</p>
```

## UX-T2: Tailwind scale for spacing and sizing

```tsx
// GO
<div className="gap-4 p-6">

// NO-GO
<div className="gap-[13px] p-[22px]">
```

## UX-T3: Classes and variants, not inline styles

Inline `style` is acceptable only for values computed at runtime (a progress width, a virtualized row offset).

```tsx
// GO
<Progress value={progress} />

// NO-GO
<div style={{ padding: 16, borderRadius: 8 }}>
```

## UX-M1: Use the recorded motion mechanism

`ux.config.json` → `motion` decides the project's mechanism. `framer-motion` is never used; the package is now `motion`.

- `"motion"`: animate with `motion/react`. Keyframes come only from what shadcn ships (`tw-animate-css`).
- `"css"`: animate with CSS keyframes and transitions in the global stylesheet, exposed as utility classes. No `motion` dependency.

```tsx
// GO with "motion"
import { motion } from "motion/react";

// GO with "css": keyframes defined once in globals.css
<div className="animate-fade-up">

// NO-GO with "css"
import { motion } from "motion/react";

// NO-GO always
import { motion } from "framer-motion";
```

## UX-M2: Animation lives in the catalog

Micro-animations (press feedback, reveal, list enter, number ticker) are catalog components or variants. Pages use them by name. Every animation respects `prefers-reduced-motion` (`useReducedMotion()` with motion, `motion-safe:` / `motion-reduce:` with CSS).

```tsx
// GO
<Reveal><StatTile ... /></Reveal>

// NO-GO: one-off animation on a page
<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
```

---
name: wireframe
description: "Create and edit UI wireframes using the Wireweave DSL — a compact, token-efficient markup language that renders to SVG. Use this skill whenever the user wants to create wireframes, mockups, UI sketches, screen layouts, or prototype interfaces. Also trigger when the user mentions .wf files, wireweave, or wants to visualize a UI component, page layout, or user flow. Even if they just describe a UI ('make me a login page', 'design a settings screen', 'sketch out the dashboard'), use this skill to produce a wireframe."
---

# Wireframe Skill

Create UI wireframes using the Wireweave DSL — a compact text format that reads like shorthand for UI components. Source files (`.wf`) are human/AI-readable and render to SVG for visual review.

## Why Wireframe over ASCII wireframes

- **Token-efficient**: ~5-10x fewer tokens than ASCII art for the same UI
- **Structured**: components have typed attributes, not freeform text
- **Annotatable**: built-in marker + annotations system for spec comments
- **Renderable**: produces clean SVG wireframes from source

## Quick Syntax Overview

```wireframe
page "Page Title" device=iphone14 {
  header p=4 border {
    title "App Name" level=3
  }
  main p=6 {
    card p=4 shadow=md {
      title "Section" level=2
      input "Email" type=email required
      button "Submit" primary w=full
    }
  }
}
```

Key patterns:
- Components are keywords followed by optional label in quotes, then attributes, then `{ children }`
- Boolean attributes are bare flags: `primary`, `disabled`, `checked`, `border`
- Key-value attributes: `type=email`, `gap=4`, `shadow=md`
- Spacing scale: `p=4` means 16px (1=4px, 2=8px, 3=12px, 4=16px, 6=24px, 8=32px)
- Comments: `// line` and `/* block */` anywhere

For the full component reference (all 38 components, attributes, examples), read `references/components.md` in this skill directory.

## Workflow

### 1. Project Setup

Before writing wireframes, ensure the project has `@wireweave/core` installed. Check for a `package.json` first — if the project doesn't have one, initialize it:

```bash
npm init -y
npm install @wireweave/core
```

### 2. Folder Structure

Use this convention in the project:

```
wireframes/
├── src/           # .wf source files
│   ├── login.wf
│   ├── dashboard.wf
│   └── settings.wf
└── svg/           # rendered SVGs (generated, gitignored or committed)
    ├── login.svg
    ├── dashboard.svg
    └── settings.svg
```

Create these directories if they don't exist. The `svg/` directory is auto-created by the render script.

### 3. Writing Wireframes

Write `.wf` files in `wireframes/src/`. Each file typically contains one `page` block, but can contain multiple pages.

Read `references/components.md` when you need to look up specific component syntax or attributes.

#### Common Patterns

**Full-page layout:**
```wireframe
page "Dashboard" {
  header p=4 border {
    row flex justify=between align=center {
      title "App" level=3
      nav ["Home", "Settings", "Profile"]
    }
  }
  main p=6 {
    row gap=4 {
      col span=8 { /* main content */ }
      col span=4 { /* sidebar content */ }
    }
  }
  footer p=4 border {
    text "Footer" muted size=sm align=center
  }
}
```

**Form layout:**
```wireframe
card p=6 {
  title "Create Account" level=2 mb=4
  stack gap=4 {
    input "Full Name" required
    input "Email" type=email required
    input "Password" type=password required
    select "Role" ["Admin", "Editor", "Viewer"]
    checkbox "I agree to terms"
  }
  row flex justify=end gap=2 mt=6 {
    button "Cancel" outline
    button "Create" primary
  }
}
```

**Data table:**
```wireframe
card p=4 {
  row flex justify=between align=center mb=4 {
    title "Users" level=3
    button "Add User" primary size=sm
  }
  table striped hover [
    ["Name", "Email", "Role", "Status"],
    ["Alice", "alice@co.com", "Admin", "Active"],
    ["Bob", "bob@co.com", "Editor", "Pending"]
  ]
}
```

### 4. Annotating Components

Use the built-in annotation system to add spec comments, styling notes, or behavioral descriptions to specific components. This is the key feature that makes wireframes useful as living documentation.

```wireframe
page "Login" {
  card p=6 {
    relative {
      input "Email" type=email required
      marker 1 anchor=top-right color=blue
    }
    relative {
      button "Sign In" primary w=full
      marker 2 anchor=top-right color=blue
    }
  }

  annotations title="Design Specifications" {
    item 1 "Email Input" {
      text "- Font: Inter 14px"
      text "- Border: 1px solid #E2E8F0, radius 8px"
      text "- Focus ring: 2px blue-500"
      text "- Validates email format on blur"
    }
    item 2 "Sign In Button" {
      text "- Background: blue-600, hover: blue-700"
      text "- Height: 44px (touch target)"
      text "- Disabled until form valid"
      text "- Shows spinner during API call"
    }
  }
}
```

Wrap any component in `relative { ... }` and add a `marker N` to tag it. Then reference markers by number in the `annotations` block. Marker colors: `blue` (default), `red`, `green`, `yellow`, `purple`, `orange`.

### 5. Rendering to SVG

Use the bundled render script to convert `.wf` files to SVG:

```bash
node <skill-path>/scripts/render.mjs wireframes/src wireframes/svg
```

Where `<skill-path>` is the path to this skill directory. The script:
- Reads all `.wf` files from the source directory
- Renders each to SVG using `@wireweave/core`
- Writes SVGs to the output directory (created if missing)
- Supports `--theme dark` flag for dark mode
- Supports `--width 1200` to set SVG width (default: 1200)

To render a single file:
```bash
node <skill-path>/scripts/render.mjs wireframes/src/login.wf wireframes/svg/
```

### 6. Using in Markdown / GitHub

Since GitHub doesn't natively render Wireweave, reference the generated SVGs:

```markdown
## Login Screen

![Login wireframe](./wireframes/svg/login.svg)

See [source](./wireframes/src/login.wf) for the wireframe definition.
```

For automated rendering on push, a GitHub Action can run the render script and commit SVGs. But for most workflows, rendering locally before commit is simpler.

## Device Presets

Use `device=` on a page to set viewport dimensions:

| Preset | Size | Category |
|--------|------|----------|
| `desktop` | 1440x900 | desktop (default) |
| `desktop-sm` | 1280x800 | desktop |
| `desktop-lg` | 1920x1080 | desktop |
| `ipad` | 1024x768 | tablet |
| `ipad-portrait` | 768x1024 | tablet |
| `iphone-se` | 375x667 | mobile |
| `iphone14` | 390x844 | mobile |
| `iphone14-pro-max` | 430x932 | mobile |
| `android` | 360x800 | mobile |

Or use `viewport="1920x1080"` or `width=375 height=812` for custom sizes.

## Tips

- Use `stack` (not `col`) for vertical groups that should only take content height (form fields, card content)
- Use `col` when you want elements to fill available vertical space
- `row` is horizontal flex — use `span=N` on children for 12-column grid
- `gap=4` on a container adds 16px between children — prefer this over individual margins
- `w=full` makes a component fill its parent width
- Keep wireframes focused: one page per `.wf` file is clearest
- Use annotations liberally — they render as a separate documentation panel, not inline clutter

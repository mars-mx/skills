# Wireweave Component Reference

All 38 components organized by category. Each entry shows the keyword, accepted attributes, and example syntax.

## Table of Contents

1. [Common Attributes](#common-attributes) — available on ALL components
2. [Layout](#layout) — page, header, main, footer, sidebar, section, divider
3. [Grid](#grid) — row, col, stack, relative
4. [Containers](#containers) — card, modal, drawer, accordion
5. [Text](#text) — text, title, link
6. [Inputs](#inputs) — input, textarea, select, checkbox, radio, switch, slider, button
7. [Display](#display) — image, placeholder, avatar, badge, icon
8. [Data](#data) — table, list
9. [Feedback](#feedback) — alert, toast, progress, spinner
10. [Overlays](#overlays) — tooltip, popover, dropdown
11. [Navigation](#navigation) — nav, tabs, breadcrumb
12. [Annotations](#annotations) — marker, annotations, item

---

## Common Attributes

Available on every component.

### Spacing

| Attr | Description | Scale |
|------|-------------|-------|
| `p` | Padding (all sides) | 0=0, 1=4px, 2=8px, 3=12px, 4=16px, 5=20px, 6=24px, 8=32px, 10=40px, 12=48px, 16=64px, 20=80px |
| `px`, `py` | Horizontal / vertical padding | same scale |
| `pt`, `pr`, `pb`, `pl` | Individual side padding | same scale |
| `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` | Margin (same as padding) | same scale, `mx="auto"` supported |
| `gap` | Gap between children | same scale |

### Size

| Attr | Values |
|------|--------|
| `w` | number, `full`, `auto`, `screen`, `fit`, or CSS unit (`100%`, `300px`) |
| `h` | number, `full`, `auto`, `screen`, or CSS unit |
| `minW`, `maxW`, `minH`, `maxH` | number or CSS unit |

### Flex

| Attr | Values |
|------|--------|
| `flex` | boolean flag — enables flexbox |
| `direction` | `row`, `column`, `row-reverse`, `column-reverse` |
| `justify` | `start`, `center`, `end`, `between`, `around`, `evenly` |
| `align` | `start`, `center`, `end`, `stretch`, `baseline` |
| `wrap` | boolean or `nowrap` |

### Grid

| Attr | Values |
|------|--------|
| `span` | 1-12 (column span in a 12-column grid) |

### Visual

| Attr | Values |
|------|--------|
| `bg` | `muted`, `primary`, `secondary` |
| `border` | boolean flag |
| `shadow` | `none`, `sm`, `md`, `lg`, `xl` |
| `rounded` | boolean flag |

### Attribute Value Types

| Type | Syntax | Example |
|------|--------|---------|
| String | `"..."` or `'...'` | `placeholder="Enter text"` |
| Number | integer or decimal | `gap=4`, `value=0.5` |
| CSS unit | number + unit | `size=24px`, `w=100%`, `h=2rem` |
| Boolean | bare flag | `primary`, `disabled`, `checked` |
| Identifier | bare word | `variant=success`, `position=left` |
| Array | `[...]` | `["a", "b", "c"]` |
| Object | `{key=val}` | `{ label="Home" active }` |

---

## Layout

### page
Top-level container. Every `.wf` file needs at least one.

```wireframe
page "Title" { children }
page "Mobile" device=iphone14 { }
page "Custom" viewport="1920x1080" { }
page "Centered" centered { }
page "Explicit" width=375 height=812 { }
```

Attrs: `title`, `width`, `height`, `viewport`, `device`, `centered`

### header
```wireframe
header border p=4 { children }
```
Attrs: `border`

### main
```wireframe
main scroll p=6 { children }
```
Attrs: `scroll`

### footer
```wireframe
footer border p=4 { children }
```
Attrs: `border`

### sidebar
```wireframe
sidebar position=left border w=250 { children }
sidebar position=right bg=muted { children }
```
Attrs: `position` (left|right), `border`, `bg`

### section
Collapsible section with a title.
```wireframe
section "Details" expanded { children }
section "Advanced" { children }
```
Attrs: `title`, `expanded`

### divider
```wireframe
divider
divider vertical
```
Attrs: `vertical`

---

## Grid

### row
Horizontal flex container. Children use `span=N` for 12-column grid.
```wireframe
row gap=4 {
  col span=4 { text "Left" }
  col span=8 { text "Right" }
}
row flex justify=between align=center { children }
```
Attrs: `border`, `bg`

### col
Vertical flex container. Fills available space (`flex: 1`).
```wireframe
col span=6 { children }
col span=3 border p=4 { children }
```
Attrs: `span`, `sm`, `md`, `lg`, `xl`, `order`, `border`, `bg`, `scroll`

### stack
Vertical container that only takes content height. Use for form groups, card bodies — when you don't want flex-grow behavior.
```wireframe
stack gap=4 {
  input "Name"
  input "Email" type=email
  button "Submit" primary
}
```
Attrs: `border`, `bg`

### relative
Position-relative container. First child is base, subsequent children overlay with `anchor` positioning. Used with `marker` for annotations.
```wireframe
relative {
  button "Submit"
  marker 1 anchor=top-right
}
```

---

## Containers

### card
```wireframe
card p=4 shadow=md border rounded { children }
card "Card Title" p=6 { children }
```
Attrs: `title`, `shadow` (none|sm|md|lg|xl), `border`, `rounded`

### modal
```wireframe
modal "Confirm Delete" {
  text "Are you sure?"
  row flex justify=end gap=2 mt=4 {
    button "Cancel" outline
    button "Delete" danger
  }
}
```
Attrs: `title`

### drawer
```wireframe
drawer "Menu" position=left w=300 { children }
drawer "Filters" position=right { children }
```
Attrs: `title`, `position` (left|right|top|bottom)

### accordion
```wireframe
accordion {
  section "FAQ 1" expanded { text "Answer 1" }
  section "FAQ 2" { text "Answer 2" }
}
```

---

## Text

### text
```wireframe
text "Hello World"
text "Large bold" size=lg weight=bold
text "Hint" muted
text "Centered" align=center
text "Custom" size=24px
```
Attrs: `size` (xs|sm|base|md|lg|xl|2xl|3xl or CSS), `weight` (normal|medium|semibold|bold), `muted`, `bold`, `align` (left|center|right|justify)

### title
```wireframe
title "Page Heading" level=1
title "Section" level=2
title "Subsection" level=3 size=2xl
```
Attrs: `level` (1-6), `size`, `align`

### link
```wireframe
link "Click here" href="https://example.com"
link "Opens new tab" href="#" external
```
Attrs: `href`, `external`

---

## Inputs

### input
```wireframe
input "Email" type=email placeholder="you@example.com" required
input "Password" type=password
input "Search" type=search icon=search
input "Name" value="John" disabled
input "Phone" type=tel
```
Types: `text`, `email`, `password`, `number`, `tel`, `url`, `search`, `date`
Attrs: `label`, `inputType`/`type`, `placeholder`, `value`, `disabled`, `required`, `readonly`, `icon`, `size`, `rounded`

### textarea
```wireframe
textarea "Message" rows=4 placeholder="Enter comments..."
textarea "Bio" required
```
Attrs: `label`, `placeholder`, `value`, `rows`, `disabled`, `required`

### select
```wireframe
select "Country" ["USA", "Germany", "Japan"]
select "Role" ["Admin", "Editor", "Viewer"] required
```
Attrs: `label`, `placeholder`, `value`, `disabled`, `required`

### checkbox
```wireframe
checkbox "I agree" checked
checkbox "Remember me"
checkbox "Disabled" disabled
```
Attrs: `label`, `checked`, `disabled`

### radio
```wireframe
radio "Option A" name=plan checked
radio "Option B" name=plan
radio "Option C" name=plan
```
Attrs: `label`, `name`, `checked`, `disabled`

### switch
```wireframe
switch "Dark mode" checked
switch "Notifications" disabled
```
Attrs: `label`, `checked`, `disabled`

### slider
```wireframe
slider "Volume" min=0 max=100 value=50 step=5
slider "Brightness" min=0 max=255 value=128
```
Attrs: `label`, `min`, `max`, `value`, `step`, `disabled`

### button
```wireframe
button "Submit" primary
button "Cancel" outline
button "Delete" danger
button "Save" primary size=lg loading
button "Icon" ghost size=sm icon=settings
button "Full Width" primary w=full
button "Small" secondary size=xs
```
Variants (flags): `primary`, `secondary`, `outline`, `ghost`, `danger`
Attrs: `size` (xs|sm|md|lg|xl), `icon`, `disabled`, `loading`

---

## Display

### image
```wireframe
image "photo.jpg" alt="Profile photo"
```
Attrs: `src`, `alt`

### placeholder
Gray box placeholder for images/content. Has children.
```wireframe
placeholder "Hero Image" w=full h=200
placeholder "Map" w=400 h=300
```
Attrs: `label`

### avatar
```wireframe
avatar "JD" size=lg
avatar "John Doe" src
```
Attrs: `name`, `src`, `size`

### badge
```wireframe
badge "Active" variant=success pill
badge "3" variant=danger anchor=top-right
badge "Beta" variant=warning
badge "New" variant=info
```
Variants: `default`, `primary`, `secondary`, `success`, `warning`, `danger`, `info`
Attrs: `variant`, `pill`, `icon`, `size`, `anchor`

### icon
```wireframe
icon "settings" size=lg
icon "search" muted
icon "chevron-right"
```
Attrs: `name`, `size`, `muted`

---

## Data

### table
Two syntax forms:

**Array syntax (compact):**
```wireframe
table striped hover [
  ["Name", "Email", "Status"],
  ["Alice", "alice@co.com", "Active"],
  ["Bob", "bob@co.com", "Pending"]
]
```

**Block syntax:**
```wireframe
table bordered {
  columns ["Name", "Email", "Status"]
  row ["Alice", "alice@co.com", "Active"]
  row ["Bob", "bob@co.com", "Pending"]
}
```
Attrs: `striped`, `bordered`, `hover`

### list
**Array syntax:**
```wireframe
list ["Item 1", "Item 2", "Item 3"]
list ["Step 1", "Step 2", "Step 3"] ordered
```

**Block syntax (supports nesting):**
```wireframe
list {
  item "Parent item" {
    item "Nested child"
    item "Another child"
  }
  item "Sibling"
}
```
Attrs: `ordered`, `none` (no bullets), `gap`

---

## Feedback

### alert
```wireframe
alert "Success!" variant=success dismissible
alert "Warning: check input" variant=warning icon=alert-triangle
alert "Error occurred" variant=danger
alert "FYI" variant=info
```
Variants: `success`, `warning`, `danger`, `info`
Attrs: `variant`, `dismissible`, `icon`

### toast
```wireframe
toast "Saved!" position=top-right variant=success
toast "Error" position=bottom-center variant=danger
```
Positions: `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`
Attrs: `position`, `variant`

### progress
```wireframe
progress value=75 max=100 label="75%"
progress value=30 max=100
progress indeterminate
```
Attrs: `value`, `max`, `label`, `indeterminate`

### spinner
```wireframe
spinner size=lg
spinner "Loading..." size=48
spinner size=36px
```
Attrs: `label`, `size`

---

## Overlays

### tooltip
```wireframe
tooltip "Helpful tip" position=top
tooltip "More info" position=bottom
```
Positions: `top`, `right`, `bottom`, `left`
Attrs: `position`

### popover
Has children.
```wireframe
popover "Settings" {
  text "Adjust your preferences"
  button "Apply" primary size=sm
}
```
Attrs: `title`

### dropdown
**Array syntax:**
```wireframe
dropdown ["Edit", "Duplicate", "---", "Delete"]
```
Use `"---"`, `"-"`, or `"divider"` for divider items.

**Block syntax:**
```wireframe
dropdown {
  item "Edit" icon=edit
  item "Duplicate" icon=copy
  divider
  item "Delete" danger
}
```

---

## Navigation

### nav
**Array syntax:**
```wireframe
nav ["Home", "About", "Contact"]
nav ["Dashboard", "Settings"] vertical
```

**Array with objects:**
```wireframe
nav [
  { label="Home" icon=home active }
  { label="Settings" icon=settings }
]
```

**Block syntax (groups + dividers):**
```wireframe
nav {
  group "Main" {
    item "Home" icon=home active
    item "Dashboard" icon=layout
  }
  divider
  group "Account" {
    item "Profile" icon=user
    item "Logout" icon=log-out
  }
}
```
Attrs: `vertical`

### tabs
**Array syntax:**
```wireframe
tabs ["Overview", "Details", "History"] active=0
```

**Block syntax with content:**
```wireframe
tabs {
  tab "Overview" active {
    text "Overview content here"
  }
  tab "Details" {
    text "Details content here"
  }
}
```
Attrs: `active`

### breadcrumb
```wireframe
breadcrumb ["Home", "Products", "Phones"]

breadcrumb [
  { label="Home" href="/" }
  { label="Products" href="/products" }
  { label="Phones" }
]
```

---

## Annotations

The annotation system lets you attach numbered spec comments to any component. Annotations render as a separate documentation panel — they don't clutter the wireframe itself.

### marker
Place inside a `relative` wrapper around the target component.
```wireframe
relative {
  input "Email" type=email
  marker 1 anchor=top-right color=blue
}
```
Attrs: `color` (blue|red|green|yellow|purple|orange), `anchor` (top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right)

### annotations
Container for annotation items. Place at the end of a page.
```wireframe
annotations title="Specifications" {
  item 1 "Component Name" {
    text "- Note about styling"
    text "- Note about behavior"
  }
}
```
Attrs: `title`

### item (inside annotations)
References a marker by number. Has a title and child text nodes.
```wireframe
item 1 "Email Field" {
  text "- Validates on blur"
  text "- Shows error below field"
  text "- 255 char max"
}
```

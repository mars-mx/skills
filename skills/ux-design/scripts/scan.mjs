#!/usr/bin/env node
// Usage: node scan.mjs [project-root] [--files <path> ...]
// Prints one JSON object per candidate hit: {file, line, rule, snippet}.
// Hits are candidates, not verdicts: an agent judges each one against references/rules.md.
// Entries in ux.config.json "exceptions" ({file, rule}) are skipped.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readConfig } from "./checks.mjs";

const args = process.argv.slice(2);
const filesFlag = args.indexOf("--files");
const root = resolve(filesFlag === 0 ? process.cwd() : (args[0] ?? process.cwd()));
const config = readConfig(root) ?? {};
const catalog = (config.catalog ?? ["src/components/ui"]).map((p) => p.replace(/\/$/, ""));
const exceptions = config.exceptions ?? [];

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", "storybook-static", ".turbo",
]);
const EXTENSIONS = /\.(tsx|jsx|ts|js)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.test(name)) out.push(path);
  }
  return out;
}

const files =
  filesFlag >= 0 ? args.slice(filesFlag + 1).map((f) => resolve(root, f)) : walk(root);

const MOTION_IMPORT = /from\s+["'](motion(\/[\w-]+)?|framer-motion)["']/;
const OVERLAY = /<(Dialog|Sheet|Drawer|AlertDialog|DropdownMenu|Popover|Tooltip|HoverCard)\w*\b/;
const STYLE_CONTEXT = /className|class=|style=|cn\(|cva\(/;
const PALETTE =
  /\b(bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-\d{2,3})?\b/;

// Line rules. scope "feature" runs outside the catalog, "all" runs everywhere.
const LINE_RULES = [
  { rule: "UX-C2", scope: "feature", test: (l) => /<(button|input|select|textarea|dialog|table|label|hr)\b/.test(l) },
  {
    rule: "UX-C3",
    scope: "feature",
    test: (l) => /from\s+["'](@radix-ui\/|radix-ui|@base-ui-components\/|@base-ui\/|vaul|cmdk|react-day-picker)/.test(l),
  },
  {
    rule: "UX-T1",
    scope: "feature",
    test: (l) =>
      STYLE_CONTEXT.test(l) && (/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch)\(/.test(l) || PALETTE.test(l) || /\bdark:(bg|text|border)-/.test(l)),
  },
  {
    rule: "UX-C6",
    scope: "feature",
    test: (l) =>
      (STYLE_CONTEXT.test(l) && /\b(space-[xy]-\d|animate-pulse)\b/.test(l)) ||
      /\b(isLoading|isPending)=/.test(l) ||
      (OVERLAY.test(l) && /className=.*\bz-(\d+|\[)/.test(l)),
  },
  { rule: "UX-T2", scope: "feature", test: (l) => STYLE_CONTEXT.test(l) && /\b[a-z][\w-]*-\[[^\]]+\]/.test(l) },
  { rule: "UX-T3", scope: "feature", test: (l) => /style=\{\{/.test(l) },
  {
    rule: "UX-M1",
    scope: "all",
    test: (l) => /from\s+["']framer-motion["']/.test(l) || (config.motion === "css" && MOTION_IMPORT.test(l)),
  },
  { rule: "UX-M2", scope: "feature", test: (l) => MOTION_IMPORT.test(l) || /@keyframes|\banimate-\[/.test(l) },
];

// UX-C4: long className on a catalog (capitalized) component hints at inline restyling.
const RESTYLE = /<([A-Z][\w.]*)\b[^>]*?className=(?:"([^"]*)"|\{\s*["'`]([^"'`]*)["'`])/g;
const RESTYLE_MIN_CLASSES = 6;

const isCatalog = (rel) => catalog.some((p) => rel === p || rel.startsWith(`${p}/`));
const isStory = (rel) => /\.stories\.[jt]sx?$/.test(rel);
const isExcepted = (rel, rule) => exceptions.some((e) => e.file === rel && e.rule === rule);

let count = 0;
const emit = (hit) => {
  if (isExcepted(hit.file, hit.rule)) return;
  count++;
  console.log(JSON.stringify(hit));
};

for (const path of files) {
  const rel = relative(root, path);
  if (isStory(rel)) continue;
  const feature = !isCatalog(rel);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    for (const r of LINE_RULES) {
      if (r.scope === "feature" && !feature) continue;
      if (r.test(line)) emit({ file: rel, line: i + 1, rule: r.rule, snippet: line.trim().slice(0, 160) });
    }
  });

  if (!feature || !/\.[jt]sx$/.test(rel)) continue;
  for (const m of text.matchAll(RESTYLE)) {
    const classes = (m[2] ?? m[3]).split(/\s+/).filter(Boolean);
    if (classes.length < RESTYLE_MIN_CLASSES) continue;
    const line = text.slice(0, m.index).split("\n").length;
    emit({ file: rel, line, rule: "UX-C4", snippet: `<${m[1]} className="${classes.join(" ")}"`.slice(0, 160) });
  }
}

console.error(`${count} candidate hits in ${files.length} files`);

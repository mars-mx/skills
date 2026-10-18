#!/usr/bin/env node
// Usage: node install.mjs [project-root] [check-id ...]
// Runs the fix command of every failed check, or only of the named checks.
// Mutates the project: run it only after the user agreed.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { runChecks } from "./checks.mjs";

const [rootArg, ...only] = process.argv.slice(2);
const root = resolve(rootArg ?? process.cwd());

const todo = runChecks(root).filter(
  (c) => !c.ok && c.fix && (only.length === 0 || only.includes(c.id)),
);

if (todo.length === 0) {
  console.log("Nothing to install.");
  process.exit(0);
}

for (const c of todo) {
  console.log(`\n> ${c.fix}`);
  execSync(c.fix, { cwd: root, stdio: "inherit" });
}

if (todo.some((c) => c.id === "shadcn-mcp")) {
  console.log("\nRestart the Claude Code session so the shadcn MCP tools load.");
}

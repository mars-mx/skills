#!/usr/bin/env node
// Usage: node preflight.mjs [project-root]
// Exit 0 when every gate passes, 1 otherwise.
import { resolve } from "node:path";
import { runChecks } from "./checks.mjs";

const root = resolve(process.argv[2] ?? process.cwd());
const checks = runChecks(root);

for (const c of checks) {
  const status = c.ok ? "PASS" : c.level === "gate" ? "FAIL" : "WARN";
  console.log(`${status}  ${c.id.padEnd(15)} ${c.message}`);
  if (!c.ok && c.fix) console.log(`      fix: ${c.fix}`);
}

const failed = checks.filter((c) => !c.ok && c.level === "gate");
if (failed.length) {
  console.log(`\nPreflight failed: ${failed.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
console.log("\nPreflight passed.");

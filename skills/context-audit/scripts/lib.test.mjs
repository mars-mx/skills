import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bashHead, inputSummary, projectDirName, resultTokens, toolGroup } from "./lib.mjs";
import { scanFile } from "./toolcalls.mjs";
import { sessionBaseline } from "./baseline.mjs";
import { frontmatter, indexEntries, lintDir, renderIndex } from "./memory.mjs";

test("bash head skips cd, env, and assignments, keeps CLI subcommands", () => {
  assert.equal(bashHead("cd /x && git log --oneline"), "git log");
  assert.equal(bashHead("FOO=1 BAR=2 npm run build"), "npm run");
  assert.equal(bashHead("S=/tmp/a; cat $S/x"), "cat");
  assert.equal(bashHead("/usr/bin/grep -rn foo ."), "grep");
});

test("tool groups split MCP by server and Bash by command", () => {
  assert.equal(toolGroup("mcp__posthog__exec", {}), "mcp:posthog");
  assert.equal(toolGroup("Bash", { command: "kubectl get pods -A" }), "Bash:kubectl get");
  assert.equal(toolGroup("Read", { file_path: "/a" }), "Read");
  assert.equal(inputSummary("Read", { file_path: "/a.ts", offset: 10, limit: 50 }), "/a.ts [10+50]");
});

test("result tokens count text by chars and images at a fixed cost", () => {
  assert.equal(resultTokens("x".repeat(400)), 100);
  assert.equal(resultTokens([{ type: "text", text: "x".repeat(40) }, { type: "image", source: {} }]), 1610);
});

test("project dir names replace every non-alphanumeric char", () => {
  assert.equal(projectDirName("/Users/mars/orca/skills"), "-Users-mars-orca-skills");
  assert.equal(projectDirName("/a/b.c_d"), "-a-b-c-d");
});

const ts = new Date().toISOString();
const asst = (req, content, usage) => JSON.stringify({ type: "assistant", requestId: req, timestamp: ts, cwd: "/p", sessionId: "s", message: { model: "m", content, usage } });
const result = (id, content) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });

test("carried cost counts requests left until compaction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ca-"));
  const file = join(dir, "s.jsonl");
  writeFileSync(file, [
    asst("r1", [{ type: "tool_use", id: "a", name: "Read", input: { file_path: "/big" } }]),
    result("a", "x".repeat(4000)),
    asst("r2", [{ type: "tool_use", id: "b", name: "Bash", input: { command: "ls" } }]),
    result("b", "y".repeat(40)),
    asst("r3", [{ type: "text", text: "ok" }]),
    JSON.stringify({ type: "system", subtype: "compact_boundary" }),
    asst("r4", [{ type: "text", text: "after" }]),
  ].join("\n"));
  const calls = await scanFile({ file, subagent: false, dir: "d" });
  const a = calls.find((c) => c.id === "a");
  assert.equal(a.tokens, 1000);
  assert.equal(a.remaining, 3);
  assert.equal(a.carried, 3000);
  assert.equal(calls.find((c) => c.id === "b").remaining, 2);
});

test("baseline scales parts to the measured first request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ca-"));
  const file = join(dir, "s.jsonl");
  writeFileSync(file, [
    JSON.stringify({ type: "api-request-shape", shape: { system: [{ text: "a" }, { text: "b" }, { text: "x".repeat(98) }], tools: [{ name: "mcp__big__t", d: "y".repeat(80) }, { name: "Defer", defer_loading: true }] } }),
    JSON.stringify({ type: "attachment", attachment: { type: "skill_listing" }, rendered: "z".repeat(100) }),
    JSON.stringify({ type: "attachment", attachment: { type: "hook_success", hookName: "PreToolUse:Bash" } }),
    asst("r1", [], { input_tokens: 10, cache_creation_input_tokens: 290, cache_read_input_tokens: 0 }),
  ].join("\n"));
  const r = await sessionBaseline(file);
  assert.equal(r.measured, 300);
  assert.equal(r.toolCount, 2);
  assert.equal(r.deferred, 1);
  assert.ok(r.parts["tools mcp:big"] > 0);
  assert.ok(r.parts.skill_listing > 0);
  assert.equal(r.parts["hook PreToolUse:Bash"], undefined);
  const sum = Object.values(r.parts).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum - 300) <= 3);
});

test("memory lint finds orphans, dangling entries, broken links, and session state", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.md"), "---\nname: a\ndescription: \"lasting fact\"\nmetadata:\n  type: feedback\n---\n\nSee [[b]] and [[gone]].\n");
  writeFileSync(join(dir, "b.md"), "---\nname: b\ndescription: deploy plan\nmetadata:\n  type: project\n---\n\nMorgen weiter.\n");
  writeFileSync(join(dir, "MEMORY.md"), "- [A](a.md) — fact\n- [Old](old.md) — removed\n");
  const r = lintDir(dir);
  assert.deepEqual(r.orphans, ["b.md"]);
  assert.deepEqual(r.dangling, ["old.md"]);
  assert.deepEqual(r.brokenLinks, ["a.md -> [[gone]]"]);
  assert.equal(r.memories.find((m) => m.file === "b.md").temporal, "Morgen");
  assert.equal(r.memories.find((m) => m.file === "a.md").type, "feedback");
  assert.equal(frontmatter("---\nname: x\n---\nbody").body, "body");
  assert.equal(renderIndex(dir), "- [a](a.md) — lasting fact\n- [b](b.md) — deploy plan\n");
  assert.equal(indexEntries(renderIndex(dir)).length, 2);
});

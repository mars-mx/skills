#!/usr/bin/env node
// Usage: node toolcalls.mjs [--days 7] [--project <path>] [--top 20] [--batch 25] [--batches 8] [--out <dir>]
// Ranks tool calls from recent transcripts (main sessions and subagents) by context cost.
// A result's tokens stay in context for every later request until the session ends or compacts,
// so "carried" = result tokens x requests left. Prints a summary and writes to --out:
//   calls.jsonl        every call, most carried first
//   batches/NN.json    the costliest calls, grouped by tool, with result excerpts for Haiku
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fmt, inputSummary, lines, parseArgs, resultText, resultTokens, toolGroup, transcripts } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { days: "7", project: "", top: "20", batch: "25", batches: "8", out: "" });
const days = Number(opts.days);
const out = opts.out || join(process.env.TMPDIR ?? tmpdir(), "context-audit", new Date().toISOString().slice(0, 10));
const since = Date.now() - days * 86_400_000;

export async function scanFile({ file, subagent, dir }) {
  const calls = new Map();
  const boundaries = [];
  const requests = new Set();
  for await (const d of lines(file, ['"type":"assistant"', '"tool_result"', "compact_boundary"])) {
    if (d.type === "system" && d.subtype === "compact_boundary") boundaries.push(requests.size);
    if (d.type === "assistant") {
      requests.add(d.requestId ?? d.message?.id);
      for (const b of d.message?.content ?? []) {
        if (b.type !== "tool_use") continue;
        calls.set(b.id, {
          id: b.id, tool: b.name, group: toolGroup(b.name, b.input), input: inputSummary(b.name, b.input),
          req: requests.size, ts: d.timestamp, cwd: d.cwd, session: d.sessionId, subagent, dir, tokens: 0,
        });
      }
    }
    if (d.type === "user" && Array.isArray(d.message?.content)) {
      for (const b of d.message.content) {
        const c = b.type === "tool_result" && calls.get(b.tool_use_id);
        if (!c) continue;
        c.tokens = resultTokens(b.content);
        c.error = b.is_error || undefined;
        const text = resultText(b.content);
        c.excerpt = text.length > 900 ? `${text.slice(0, 600)}\n[... ${text.length - 800} chars ...]\n${text.slice(-200)}` : text;
      }
    }
  }
  const total = requests.size;
  for (const c of calls.values()) {
    const end = boundaries.find((b) => b >= c.req) ?? total;
    c.remaining = Math.max(1, end - c.req + 1);
    c.carried = c.tokens * c.remaining;
  }
  return [...calls.values()].filter((c) => !c.ts || Date.parse(c.ts) >= since);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = transcripts({ days, project: opts.project });
  const all = [];
  for (const f of files) all.push(...(await scanFile(f)));
  all.sort((a, b) => b.carried - a.carried);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "batches"), { recursive: true });
  writeFileSync(join(out, "calls.jsonl"), all.map((c) => JSON.stringify(c)).join("\n"));

  const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
  const sessions = new Set(all.map((c) => c.session));
  console.log(`window: ${days}d  transcripts: ${files.length}  sessions: ${sessions.size}  tool calls: ${all.length}`);
  console.log(`result tokens: ${fmt(sum(all, "tokens"))}  carried: ${fmt(sum(all, "carried"))}  (subagent share: ${fmt(sum(all.filter((c) => c.subagent), "tokens"))} result tokens)\n`);

  const groups = new Map();
  for (const c of all) {
    const g = groups.get(c.group) ?? { group: c.group, calls: 0, tokens: 0, carried: 0, max: 0 };
    g.calls++; g.tokens += c.tokens; g.carried += c.carried; g.max = Math.max(g.max, c.tokens);
    groups.set(c.group, g);
  }
  console.log("by tool (top 20 by carried):  calls  result  avg  max  carried");
  for (const g of [...groups.values()].sort((a, b) => b.carried - a.carried).slice(0, 20)) {
    console.log(`  ${g.group.padEnd(32)} ${String(g.calls).padStart(5)}  ${fmt(g.tokens).padStart(6)}  ${fmt(Math.round(g.tokens / g.calls)).padStart(4)}  ${fmt(g.max).padStart(4)}  ${fmt(g.carried)}`);
  }

  console.log(`\ntop ${opts.top} calls by carried:`);
  for (const c of all.slice(0, Number(opts.top))) {
    console.log(`  ${fmt(c.carried).padStart(6)} = ${fmt(c.tokens)} x ${c.remaining}  ${c.subagent ? "[sub] " : ""}${c.tool}  ${c.input.slice(0, 110)}  (${c.cwd?.replace(/^.*\//, "")})`);
  }

  const reads = new Map();
  for (const c of all.filter((c) => c.tool === "Read")) {
    const k = `${c.session}\t${c.input}`;
    reads.set(k, (reads.get(k) ?? []).concat(c));
  }
  const repeated = [...reads.values()].filter((r) => r.length >= 3).sort((a, b) => sum(b, "tokens") - sum(a, "tokens")).slice(0, 10);
  if (repeated.length) {
    console.log("\nsame file read 3+ times in one session:");
    for (const r of repeated) console.log(`  ${r.length}x  ${fmt(sum(r, "tokens"))}  ${r[0].input}`);
  }

  // Haiku batches: the costliest calls, grouped by tool so each reviewer sees one kind of output.
  const pool = all.slice(0, Number(opts.batch) * Number(opts.batches));
  const byGroup = new Map();
  for (const c of pool) {
    const k = c.group.startsWith("Bash:") ? "Bash" : c.group;
    byGroup.set(k, [...(byGroup.get(k) ?? []), c]);
  }
  let n = 0;
  for (const [group, cs] of [...byGroup].sort((a, b) => sum(b[1], "carried") - sum(a[1], "carried"))) {
    for (let i = 0; i < cs.length && n < Number(opts.batches); i += Number(opts.batch)) {
      const slice = cs.slice(i, i + Number(opts.batch)).map(({ id, tool, input, tokens, remaining, carried, cwd, subagent, error, excerpt }) =>
        ({ id, tool, input, tokens, remaining, carried, project: cwd, subagent, error, excerpt }));
      writeFileSync(join(out, "batches", `${String(++n).padStart(2, "0")}.json`), JSON.stringify({ group, calls: slice }, null, 1));
    }
  }
  console.log(`\nwrote ${out}/calls.jsonl and ${n} batches in ${out}/batches/`);
}

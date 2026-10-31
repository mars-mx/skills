#!/usr/bin/env node
// Usage: node baseline.mjs [--days 7] [--project <path>] [--all] [--json]
// Measures the context a session carries before any work: the first request's input tokens
// (uncached + cache write + cache read) from the transcript's usage. Splits it into parts by
// size (system prompt, tool schemas per MCP server, attachments the model sees such as the
// skill listing, CLAUDE.md instructions, and SessionStart hook output) and scales the parts to
// the measured total. Then lists the config that feeds each part for --project (default cwd).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CLAUDE_DIR, fmt, lines, median, parseArgs, PROJECTS_DIR, projectDirName, tokens, transcripts } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { days: "7", project: "", all: false, json: false });

// One session's baseline: measured total plus byte-sized parts, scaled to the total.
export async function sessionBaseline(file) {
  const parts = {};
  const add = (k, chars) => { parts[k] = (parts[k] ?? 0) + chars; };
  let measured = 0, toolCount = 0, deferred = 0, meta = {};
  for await (const d of lines(file, ['"api-request-shape"', '"type":"attachment"', '"type":"assistant"'])) {
    if (d.type === "api-request-shape" && !toolCount) {
      for (const [i, b] of (d.shape.system ?? []).entries()) add(i === 2 ? "system prompt" : "system header", b.text?.length ?? 0);
      for (const t of d.shape.tools ?? []) {
        toolCount++;
        if (t.defer_loading) { deferred++; continue; }
        const mcp = t.name?.match(/^mcp__(.+?)__/);
        add(mcp ? `tools mcp:${mcp[1]}` : "tools built-in", JSON.stringify(t).length);
      }
    }
    if (d.type === "attachment" && d.rendered && !measured) {
      const a = d.attachment ?? {};
      add(a.type === "hook_success" ? `hook ${a.hookName}` : a.type, JSON.stringify(d.rendered).length);
    }
    if (d.type === "assistant" && !d.isSidechain && d.message?.usage) {
      const u = d.message.usage;
      measured = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      meta = { model: d.message.model, entrypoint: d.entrypoint, cwd: d.cwd, ts: d.timestamp };
      break;
    }
  }
  if (!measured) return null;
  const chars = Object.values(parts).reduce((s, x) => s + x, 0);
  const scale = chars ? measured / chars : 0;
  const scaled = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * scale)]));
  // The first user prompt is part of the measured total; it stays in "other".
  return { file, measured, toolCount, deferred, parts: scaled, ...meta };
}

async function measure(project) {
  const files = transcripts({ days: Number(opts.days), project }).filter((f) => !f.subagent);
  const rows = [];
  for (const f of files) {
    const r = await sessionBaseline(f.file);
    if (r) rows.push({ ...r, dir: f.dir });
  }
  return rows;
}

function report(rows, label) {
  if (!rows.length) return console.log(`${label}: no sessions in window`);
  const ms = rows.map((r) => r.measured);
  console.log(`${label}: ${rows.length} sessions  baseline median ${fmt(median(ms))}  min ${fmt(Math.min(...ms))}  max ${fmt(Math.max(...ms))}`);
  // Sessions differ mostly by tool shape (which MCP servers load undeferred), so group by it.
  const shapes = new Map();
  for (const r of rows) {
    const k = r.toolCount ? `${r.toolCount} tools (${r.deferred} deferred) via ${r.entrypoint}` : `tool list not recorded, via ${r.entrypoint}`;
    shapes.set(k, [...(shapes.get(k) ?? []), r]);
  }
  for (const [k, rs] of [...shapes].sort((a, b) => median(b[1].map((r) => r.measured)) - median(a[1].map((r) => r.measured)))) {
    console.log(`  ${String(rs.length).padStart(3)}x  ${fmt(median(rs.map((r) => r.measured))).padStart(5)}  ${k}`);
  }
  // Parts of the heaviest shape: the one worth fixing first.
  const heavy = [...shapes].filter(([, rs]) => rs[0].toolCount).sort((a, b) => median(b[1].map((r) => r.measured)) - median(a[1].map((r) => r.measured)))[0];
  if (!heavy) return;
  const keys = new Set(heavy[1].flatMap((r) => Object.keys(r.parts)));
  const med = [...keys].map((k) => [k, median(heavy[1].map((r) => r.parts[k] ?? 0))]).filter(([, v]) => v >= 500).sort((a, b) => b[1] - a[1]);
  console.log(`  parts of the heaviest shape (${heavy[0]}), median tokens scaled to measured:`);
  for (const [k, v] of med) console.log(`    ${fmt(v).padStart(6)}  ${k}`);
}

// Where each part comes from, for one project path.
function inventory(project) {
  const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  const json = (p) => { try { return JSON.parse(read(p)) ?? {}; } catch { return {}; } };
  const seen = new Set();
  const show = (label, p) => {
    if (seen.has(p)) return;
    seen.add(p);
    const t = read(p);
    if (t !== null) console.log(`  ${fmt(tokens(t.length)).padStart(6)}  ${t.split("\n").length} lines  ${label} ${p}`);
    for (const m of (t ?? "").matchAll(/^@(\S+)/gm)) show("  import", resolve(dirname(p), m[1].replace(/^~/, homedir())));
  };
  console.log(`\nconfig for ${project}:`);
  show("user", join(CLAUDE_DIR, "CLAUDE.md"));
  for (let d = project; d.startsWith(homedir()) && d !== homedir(); d = dirname(d)) {
    for (const f of ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) if (existsSync(join(d, f))) show("project", join(d, f));
  }
  const rules = join(project, ".claude/rules");
  if (existsSync(rules)) for (const f of readdirSync(rules, { recursive: true })) if (String(f).endsWith(".md")) show("rule", join(rules, String(f)));
  const mem = join(PROJECTS_DIR, projectDirName(project), "memory");
  if (existsSync(mem)) {
    show("memory index", join(mem, "MEMORY.md"));
    const n = readdirSync(mem).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").length;
    console.log(`          ${n} memory files in ${mem}`);
  }

  const user = json(join(CLAUDE_DIR, "settings.json"));
  const proj = { ...json(join(project, ".claude/settings.json")), ...json(join(project, ".claude/settings.local.json")) };
  const plugins = { ...user.enabledPlugins, ...proj.enabledPlugins };
  console.log(`  plugins enabled: ${Object.keys(plugins).filter((k) => plugins[k]).join(", ") || "none"}`);
  // "auto" loads deferrable MCP tools upfront while they stay under 10% of the window; "false" never defers.
  const toolSearch = proj.env?.ENABLE_TOOL_SEARCH ?? user.env?.ENABLE_TOOL_SEARCH ?? process.env.ENABLE_TOOL_SEARCH;
  console.log(`  ENABLE_TOOL_SEARCH: ${toolSearch ?? "unset (MCP tools deferred)"}${/^(auto|false)/.test(toolSearch ?? "") ? "  <- loads MCP tools upfront" : ""}`);
  console.log(`  autoMemoryEnabled: ${proj.autoMemoryEnabled ?? user.autoMemoryEnabled ?? "default (on)"}`);
  const claudeJson = json(join(homedir(), ".claude.json"));
  const mcp = {
    user: Object.keys({ ...claudeJson.mcpServers, ...user.mcpServers }),
    local: Object.keys(claudeJson.projects?.[project]?.mcpServers ?? {}),
    project: Object.keys(json(join(project, ".mcp.json")).mcpServers ?? {}),
  };
  console.log(`  mcp servers: user [${mcp.user}]  local [${mcp.local}]  .mcp.json [${mcp.project}]  (claude.ai connectors come from the account)`);
  for (const ev of ["SessionStart", "UserPromptSubmit"]) {
    for (const h of [...(user.hooks?.[ev] ?? []), ...(proj.hooks?.[ev] ?? [])].flatMap((m) => m.hooks ?? [])) {
      console.log(`  hook ${ev}: ${String(h.command ?? h.type).replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  const skillsDir = join(CLAUDE_DIR, "skills");
  if (existsSync(skillsDir)) console.log(`  user skills: ${readdirSync(skillsDir).filter((f) => statSync(join(skillsDir, f)).isDirectory()).length} in ${skillsDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const project = resolve(opts.project || process.cwd());
  if (opts.all) {
    const rows = await measure("");
    const byProject = new Map();
    for (const r of rows) byProject.set(r.dir, [...(byProject.get(r.dir) ?? []), r]);
    report(rows, `all projects, ${opts.days}d`);
    console.log("\nper project (median baseline):");
    for (const [dir, rs] of [...byProject].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
      console.log(`  ${fmt(median(rs.map((r) => r.measured))).padStart(5)}  ${String(rs.length).padStart(3)} sessions  ${rs[0].cwd ?? dir}`);
    }
  } else {
    const rows = await measure(project);
    if (opts.json) console.log(JSON.stringify(rows, null, 1));
    else report(rows, `${project}, ${opts.days}d`);
  }
  if (!opts.json) inventory(project);
}

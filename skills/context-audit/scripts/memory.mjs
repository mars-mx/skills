#!/usr/bin/env node
// Usage:
//   node memory.mjs list    [--project <path>] [--all] [--json]   inventory and lint of auto memory
//   node memory.mjs backup  [--project <path>] [--all]            tar.gz of the memory dirs into ~/.claude/backups/
//   node memory.mjs reindex <memory-dir>                          rebuild MEMORY.md from the files' frontmatter
// Auto memory lives in ~/.claude/projects/<project>/memory/: MEMORY.md (index, loaded into every
// session) plus one file per memory with name, description, and metadata.type in its frontmatter.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CLAUDE_DIR, fmt, parseArgs, PROJECTS_DIR, projectDirName, tokens } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest, { project: "", all: false, json: false });

// Words that mark a memory as session state rather than a lasting fact.
const TEMPORAL = /\b(morgen|heute|gestern|tomorrow|today|yesterday|next step|nächste[rn]? schritt|weiter ?machen|fortsetzen|offene? (punkte|items?)|open items?|pending|todo|wip|in progress|status|stand|aktuell|currently|noch nicht|not yet|blocked|wartet|waiting)\b|\b20\d\d-\d\d-\d\d\b/i;

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*(\w+):\s*(.*)$/);
    if (kv && kv[2]) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

export function indexEntries(index) {
  return [...index.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)\s*(?:[—-]\s*(.*))?$/gm)].map((m) => ({ title: m[1], file: m[2], hook: m[3] ?? "" }));
}

export function lintDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  const indexText = existsSync(join(dir, "MEMORY.md")) ? readFileSync(join(dir, "MEMORY.md"), "utf8") : "";
  const index = indexEntries(indexText);
  const names = new Set();
  const memories = files.map((f) => {
    const text = readFileSync(join(dir, f), "utf8");
    const { fm, body } = frontmatter(text);
    names.add(fm.name ?? basename(f, ".md"));
    return {
      file: f, name: fm.name, type: fm.type, description: fm.description, tokens: tokens(text.length),
      modified: statSync(join(dir, f)).mtime.toISOString().slice(0, 10),
      links: [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]),
      temporal: (text.match(TEMPORAL) ?? [])[0],
      indexed: index.some((e) => e.file === f),
    };
  });
  return {
    dir, indexTokens: tokens(indexText.length), indexLines: indexText.split("\n").length, memories,
    dangling: index.filter((e) => !files.includes(e.file)).map((e) => e.file),
    orphans: memories.filter((m) => !m.indexed).map((m) => m.file),
    brokenLinks: memories.flatMap((m) => m.links.filter((l) => !names.has(l)).map((l) => `${m.file} -> [[${l}]]`)),
    missingFrontmatter: memories.filter((m) => !m.name || !m.description || !m.type).map((m) => m.file),
  };
}

export function renderIndex(dir) {
  const lines = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").sort().map((f) => {
    const { fm } = frontmatter(readFileSync(join(dir, f), "utf8"));
    return `- [${fm.name ?? basename(f, ".md")}](${f}) — ${fm.description ?? ""}`.trimEnd();
  });
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function memoryDirs() {
  if (opts.all) return readdirSync(PROJECTS_DIR).map((d) => join(PROJECTS_DIR, d, "memory")).filter(existsSync);
  const dir = join(PROJECTS_DIR, projectDirName(resolve(opts.project || process.cwd())), "memory");
  return existsSync(dir) ? [dir] : [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === "list") {
    const reports = memoryDirs().map(lintDir);
    if (opts.json) console.log(JSON.stringify(reports, null, 1));
    else for (const r of reports) {
      console.log(`${r.dir}\n  index: ${r.indexLines} lines, ${fmt(r.indexTokens)} tokens in every session; ${r.memories.length} files`);
      for (const m of r.memories) {
        console.log(`  ${(m.type ?? "?").padEnd(9)} ${m.modified}  ${fmt(m.tokens).padStart(5)}  ${m.file}${m.temporal ? `  [temporal: ${m.temporal}]` : ""}${m.indexed ? "" : "  [orphan]"}`);
        console.log(`            ${m.description ?? "(no description)"}`);
      }
      for (const k of ["dangling", "orphans", "brokenLinks", "missingFrontmatter"]) if (r[k].length) console.log(`  ${k}: ${r[k].join(", ")}`);
    }
    if (!reports.length) console.log("no auto memory for this project");
  } else if (cmd === "backup") {
    const dirs = memoryDirs();
    if (!dirs.length) process.exit(0);
    const backups = join(CLAUDE_DIR, "backups");
    mkdirSync(backups, { recursive: true });
    const file = join(backups, `memory-${new Date().toISOString().replace(/[:.]/g, "-")}.tgz`);
    execFileSync("tar", ["-czf", file, "-C", PROJECTS_DIR, ...dirs.map((d) => d.slice(PROJECTS_DIR.length + 1))]);
    console.log(file);
  } else if (cmd === "reindex") {
    const dir = resolve(opts._[0] ?? "");
    if (!existsSync(dir)) throw new Error(`no memory dir ${dir}`);
    writeFileSync(join(dir, "MEMORY.md"), renderIndex(dir));
    console.log(readFileSync(join(dir, "MEMORY.md"), "utf8"));
  } else {
    console.error("usage: memory.mjs list|backup|reindex ...");
    process.exit(2);
  }
}

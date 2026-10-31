// Shared helpers: find transcripts, stream their lines, and estimate tokens.
import { createReadStream, readdirSync, statSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

// Rough token estimate for text. The baseline script scales these to measured usage.
export const tokens = (chars) => Math.round(chars / 4);
export const IMAGE_TOKENS = 1600;

export function parseArgs(argv, defaults) {
  const opts = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) opts._.push(a);
    else if (typeof defaults[a.slice(2)] === "boolean") opts[a.slice(2)] = true;
    else opts[a.slice(2)] = argv[++i];
  }
  return opts;
}

// Claude Code names a project directory after its path, with every non-alphanumeric char as "-".
export const projectDirName = (path) => path.replace(/[^a-zA-Z0-9]/g, "-");

// Main and subagent transcripts modified in the last `days`, optionally for one project path.
export function transcripts({ days, project }) {
  const since = Date.now() - days * 86_400_000;
  const dirs = readdirSync(PROJECTS_DIR).filter((d) => !project || d === projectDirName(project) || d.startsWith(projectDirName(project) + "--"));
  const out = [];
  for (const d of dirs) {
    const dir = join(PROJECTS_DIR, d);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) push(join(dir, e.name), false);
      const sub = join(dir, e.name, "subagents");
      if (e.isDirectory() && existsSync(sub)) {
        for (const s of readdirSync(sub)) if (s.endsWith(".jsonl")) push(join(sub, s), true);
      }
    }
  }
  return out;
  function push(file, subagent) {
    const st = statSync(file);
    if (st.mtimeMs >= since) out.push({ file, subagent, dir: d(file), size: st.size });
  }
  function d(file) { return file.slice(PROJECTS_DIR.length + 1).split("/")[0]; }
}

// Yields parsed lines that contain one of `needles`. Skips the huge snapshot lines unparsed.
export async function* lines(file, needles) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.includes('"prompt_snapshot"') || line.startsWith('{"type":"api-request-blob"')) continue;
    if (needles && !needles.some((n) => line.includes(n))) continue;
    try { yield JSON.parse(line); } catch { /* partial line from a live session */ }
  }
}

// Size in tokens of a tool_result content (string or block list).
export function resultTokens(content) {
  if (typeof content === "string") return tokens(content.length);
  if (!Array.isArray(content)) return 0;
  let t = 0;
  for (const b of content) {
    if (b.type === "image") t += IMAGE_TOKENS;
    else if (b.type === "text") t += tokens(b.text.length);
    else t += tokens(JSON.stringify(b).length);
  }
  return t;
}

export function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
}

// Groups a tool call: MCP calls by server, Bash by its first command word.
export function toolGroup(name, input = {}) {
  const mcp = name.match(/^mcp__(.+?)__/);
  if (mcp) return `mcp:${mcp[1]}`;
  if (name === "Bash") return `Bash:${bashHead(input.command ?? "")}`;
  return name;
}

export function bashHead(cmd) {
  const parts = cmd.split(/&&|;|\|\|/).map((p) => p.trim()).filter((p) => p && !/^(cd|export|set|source)\b/.test(p) && !/^\w+=\S*$/.test(p));
  const words = (parts[0] ?? "").replace(/^(\w+=\S+\s+)+/, "").split(/\s+/).filter(Boolean);
  const head = words[0]?.replace(/^.*\//, "") ?? "";
  // Keep the subcommand for multi-command CLIs (git log, kubectl get, npm run).
  return /^(git|gh|kubectl|npm|pnpm|yarn|docker|uv|go|cargo|rtk|npx|bunx|helm|aws|gcloud|az|terraform|talosctl)$/.test(head) && words[1]
    ? `${head} ${words[1]}`
    : head;
}

// Short human-readable summary of what a call asked for.
export function inputSummary(name, input = {}) {
  const s = input.command ?? input.file_path ?? input.url ?? input.pattern ?? input.query ?? input.skill
    ?? (input.description ? `${input.subagent_type ?? "agent"}: ${input.description}` : JSON.stringify(input));
  const extra = name === "Read" && (input.offset || input.limit) ? ` [${input.offset ?? 0}+${input.limit ?? ""}]` : "";
  return String(s).replace(/\s+/g, " ").slice(0, 200) + extra;
}

export const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

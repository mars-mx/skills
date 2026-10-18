// Shared project checks for preflight.mjs and install.mjs.
// Never print config values: ~/.claude.json can hold secrets of other MCP servers.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_FILE = "ux.config.json";

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

export function packageRunner(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return { dlx: "pnpm dlx", add: "pnpm add" };
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb")))
    return { dlx: "bunx --bun", add: "bun add" };
  if (existsSync(join(root, "yarn.lock"))) return { dlx: "npx", add: "yarn add" };
  return { dlx: "npx", add: "npm install" };
}

export function readConfig(root) {
  return readJson(join(root, CONFIG_FILE));
}

function hasDependency(root, name) {
  const pkg = readJson(join(root, "package.json")) ?? {};
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

function shadcnSkillInstalled(root) {
  const home = homedir();
  return [
    join(root, ".claude/skills/shadcn/SKILL.md"),
    join(root, ".agents/skills/shadcn/SKILL.md"),
    join(home, ".claude/skills/shadcn/SKILL.md"),
    join(home, ".agents/skills/shadcn/SKILL.md"),
  ].some(existsSync);
}

function shadcnMcpConfigured(root) {
  // Project scope: .mcp.json. User and local scope: ~/.claude.json.
  if (readJson(join(root, ".mcp.json"))?.mcpServers?.shadcn) return true;
  const global = readJson(join(homedir(), ".claude.json"));
  return Boolean(global?.mcpServers?.shadcn ?? global?.projects?.[root]?.mcpServers?.shadcn);
}

// level: "gate" fails the preflight, "warn" only reports.
// fix: the install command, run by install.mjs after the user agrees.
export function runChecks(root) {
  const run = packageRunner(root);
  const config = readConfig(root);
  const checks = [
    {
      id: "shadcn-project",
      level: "gate",
      ok: existsSync(join(root, "components.json")),
      message: "components.json exists (shadcn project)",
      fix: `${run.dlx} shadcn@latest init`,
    },
    {
      id: "shadcn-skill",
      level: "gate",
      ok: shadcnSkillInstalled(root),
      message: "official shadcn skill is installed",
      fix: `${run.dlx} skills add shadcn/ui --skill shadcn -y`,
    },
    {
      id: "shadcn-mcp",
      level: "gate",
      ok: shadcnMcpConfigured(root),
      message: "official shadcn MCP server is configured",
      fix: `${run.dlx} shadcn@latest mcp init --client claude`,
    },
    {
      id: "storybook",
      level: "warn",
      ok: existsSync(join(root, ".storybook")),
      message: "Storybook is set up (.storybook/)",
      fix: `${run.dlx} storybook@latest init`,
    },
    {
      id: "decision",
      level: "gate",
      ok: ["motion", "css"].includes(config?.motion) && Array.isArray(config?.catalog),
      message: `${CONFIG_FILE} records the motion decision and catalog paths`,
      fix: null, // Decided by the user, see SKILL.md "Project decisions".
    },
  ];
  if (config?.motion === "motion") {
    checks.push({
      id: "motion-package",
      level: "gate",
      ok: hasDependency(root, "motion"),
      message: "motion package is installed (decision: motion)",
      fix: `${run.add} motion`,
    });
  }
  return checks;
}

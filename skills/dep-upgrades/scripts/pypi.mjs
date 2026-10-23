// PyPI: requirements*.txt, pyproject.toml ([project], [dependency-groups], Poetry), uv.lock / poetry.lock / pdm.lock.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { findFiles, getJSON, githubRepo, normalizeName } from "./lib.mjs";

export const ecosystem = "PyPI";

const norm = (n) => normalizeName(n, ecosystem);

// One PEP 508 requirement -> {name, spec, pinned, version} or null for URLs, options, and VCS lines.
export function parseRequirement(line) {
  const text = line.replace(/(^|\s)#.*$/, "").trim();
  if (!text || text.startsWith("-") || /:\/\/|^git\+|@\s*\w+:/.test(text)) return null;
  const m = text.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;]*?)\s*(?:;.*)?$/);
  if (!m) return null;
  const spec = m[2].replace(/^\((.*)\)$/, "$1").replace(/\s+/g, "");
  const pin = spec.match(/^===?([^,*]+)$/);
  return { name: norm(m[1]), spec: spec || "*", pinned: !!pin, version: pin ? pin[1] : null };
}

// Strings inside the TOML array that starts at the first "[" after index `from`.
function tomlArray(text, from) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (let i = text.indexOf("[", from); i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) { out.push(cur); cur = ""; quote = null; } else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  return out;
}

function tomlSections(text) {
  const sections = [];
  const re = /^\[\[?([^\]]+)\]\]?\s*$/gm;
  let m, last = null;
  while ((m = re.exec(text))) {
    if (last) last.body = text.slice(last.start, m.index);
    last = { name: m[1].trim(), start: re.lastIndex };
    sections.push(last);
  }
  if (last) last.body = text.slice(last.start);
  return sections;
}

export function parsePyproject(text) {
  const deps = [];
  for (const s of tomlSections(text)) {
    if (s.name === "project") {
      const at = s.body.search(/^dependencies\s*=/m);
      if (at >= 0) deps.push(...tomlArray(s.body, at).map((r) => ({ ...parseRequirement(r), kind: "prod" })));
    } else if (s.name === "project.optional-dependencies" || s.name === "dependency-groups") {
      for (const m of s.body.matchAll(/^([\w.-]+|"[^"]+")\s*=/gm)) {
        deps.push(...tomlArray(s.body, m.index).filter((r) => typeof r === "string").map((r) => ({ ...parseRequirement(r), kind: "optional" })));
      }
    } else if (/^tool\.poetry\.(group\.[\w-]+\.)?(dev-)?dependencies$/.test(s.name)) {
      const kind = s.name === "tool.poetry.dependencies" ? "prod" : "dev";
      for (const line of s.body.split("\n")) {
        const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|\{.*?\bversion\s*=\s*"([^"]*)".*\})/);
        if (!m || m[1] === "python") continue;
        const spec = m[2] ?? m[3];
        deps.push({ name: norm(m[1]), spec, pinned: /^=?=?\d[\w.]*$/.test(spec), version: /^=?=?\d[\w.]*$/.test(spec) ? spec.replace(/^=+/, "") : null, kind });
      }
    }
  }
  return deps.filter((d) => d.name);
}

// [[package]] blocks of uv.lock, poetry.lock, pdm.lock -> Map(normalized name -> version).
export function parseLock(text) {
  const out = new Map();
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version && !/^source\s*=\s*\{\s*(editable|virtual|directory|path)/m.test(block)) out.set(norm(name), version);
  }
  return out;
}

function isRequirementsFile(path) {
  const name = basename(path);
  return /^requirements.*\.txt$/i.test(name) || /-requirements\.txt$/i.test(name) || basename(dirname(path)) === "requirements";
}

export function discover(root) {
  const projects = [];
  for (const file of findFiles(root, (f) => f.endsWith(".txt") || f === "pyproject.toml")) {
    const dir = dirname(file);
    const text = readFileSync(file, "utf8");
    if (basename(file) === "pyproject.toml") {
      const lockPath = ["uv.lock", "poetry.lock", "pdm.lock"].map((l) => join(dir, l)).find(existsSync) ?? null;
      const lock = lockPath ? parseLock(readFileSync(lockPath, "utf8")) : new Map();
      const deps = parsePyproject(text);
      if (!deps.length) continue;
      projects.push(project(root, file, lockPath, deps.map((d) => ({ ...d, version: d.version ?? lock.get(d.name) ?? null })),
        [...lock].map(([name, version]) => ({ name, version }))));
    } else if (isRequirementsFile(file)) {
      const deps = text.split("\n").map(parseRequirement).filter(Boolean).map((d) => ({ ...d, kind: /dev|test|lint/i.test(file) ? "dev" : "prod" }));
      if (!deps.length) continue;
      // A fully pinned requirements file (pip-compile, pip freeze) is its own lockfile.
      const locked = deps.every((d) => d.pinned);
      projects.push(project(root, file, locked ? file : null, deps, deps.filter((d) => d.version)));
    }
  }
  return projects;
}

function project(root, manifest, lockPath, direct, locked) {
  return {
    ecosystem,
    dir: relative(root, dirname(manifest)) || ".",
    manifest: relative(root, manifest),
    lockfile: lockPath ? relative(root, lockPath) : null,
    lockStatus: lockPath ? `lockfile ${basename(lockPath)}` : "missing",
    direct,
    locked: locked.map(({ name, version }) => ({ name, version })),
    skipped: [],
  };
}

const cache = new Map();

export function registry(name) {
  if (!cache.has(name)) {
    cache.set(name, getJSON(`https://pypi.org/pypi/${name}/json`).then((doc) => {
      if (!doc) return null;
      const urls = doc.info?.project_urls ?? {};
      const preferred = ["Source", "Source Code", "Repository", "Code", "GitHub", "Changelog", "Homepage"];
      const repo = [...preferred.map((k) => urls[k]), ...Object.values(urls), doc.info?.home_page].map(githubRepo).find(Boolean) ?? null;
      return {
        repo,
        versions: Object.entries(doc.releases ?? {}).filter(([, files]) => files.length).map(([version, files]) => ({
          version,
          time: files.map((f) => f.upload_time_iso_8601).sort()[0] ?? null,
          yanked: files.every((f) => f.yanked),
        })),
      };
    }));
  }
  return cache.get(name);
}

export function upgradeCommand(dep, version, proj) {
  if (proj.lockStatus.includes("uv.lock")) return `uv add "${dep.name}==${version}"`;
  if (proj.lockStatus.includes("poetry.lock")) return `poetry add "${dep.name}==${version}"`;
  if (proj.lockStatus.includes("pdm.lock")) return `pdm add "${dep.name}==${version}"`;
  return `set ${dep.name}==${version} in ${proj.manifest}`;
}

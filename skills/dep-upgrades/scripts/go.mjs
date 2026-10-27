// Go: go.mod (direct and // indirect requires, replace, go/toolchain), proxy.golang.org metadata.
import { readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { compareVersions, findFiles, getJSON, getText, githubRepo, pool } from "./lib.mjs";

export const ecosystem = "Go";

const PROXY = "https://proxy.golang.org";

// Lines of a go.mod directive, from single-line and block form: "require x v1" and "require ( ... )".
function directive(text, name) {
  const out = [];
  const re = new RegExp(`^${name}\\s*(?:\\(([\\s\\S]*?)^\\)|(.+))`, "gm");
  for (const m of text.matchAll(re)) out.push(...(m[1] ?? m[2]).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")));
  return out;
}

export function parseGoMod(text) {
  const replaced = new Map();
  for (const line of directive(text, "replace")) {
    const m = line.match(/^(\S+)(?:\s+\S+)?\s+=>\s+(\S+)(?:\s+(\S+))?/);
    // A replacement by a local path has no registry version; one by a module version is checked as that module.
    if (m) replaced.set(m[1], m[3] ? { name: m[2], version: m[3] } : null);
  }
  const requires = [];
  for (const line of directive(text, "require")) {
    const m = line.match(/^(\S+)\s+(\S+)(\s*\/\/\s*indirect)?/);
    if (!m) continue;
    const [, path, version, indirect] = m;
    const repl = replaced.has(path) ? replaced.get(path) : { name: path, version };
    if (!repl) continue;
    requires.push({ name: repl.name, version: repl.version, spec: repl.version, indirect: !!indirect });
  }
  const goVersion = text.match(/^toolchain\s+go(\S+)/m)?.[1] ?? text.match(/^go\s+(\S+)/m)?.[1] ?? null;
  return { module: text.match(/^module\s+(\S+)/m)?.[1] ?? null, requires, goVersion };
}

export function discover(root) {
  return findFiles(root, (f) => f === "go.mod").map((manifest) => {
    const { requires, goVersion } = parseGoMod(readFileSync(manifest, "utf8"));
    return {
      ecosystem,
      dir: relative(root, dirname(manifest)) || ".",
      manifest: relative(root, manifest),
      // go.mod (Go 1.17+) lists the full module graph, so it is the lockfile.
      lockfile: relative(root, manifest),
      lockStatus: "go.mod",
      direct: requires.filter((r) => !r.indirect).map((r) => ({ name: r.name, spec: r.spec, kind: "prod", pinned: true, version: r.version })),
      locked: [
        ...requires.map(({ name, version }) => ({ name, version })),
        // The standard library has its own advisories; its version is the toolchain's.
        ...(goVersion ? [{ name: "stdlib", version: goVersion }] : []),
      ],
      skipped: [],
    };
  });
}

// Module paths escape upper-case letters as "!" + lower case.
const escape = (path) => path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

// "example.com/x" and "example.com/x/v3" -> {base, major}
export function splitMajor(path) {
  const m = path.match(/^(.+)\/v(\d+)$/);
  return m && !path.startsWith("gopkg.in/") ? { base: m[1], major: Number(m[2]) } : { base: path, major: 1 };
}

// Retracted versions from the latest go.mod: "retract v1.2.3" and "retract [v1.0.0, v1.0.5]".
export function retractions(mod) {
  return directive(mod, "retract").map((l) => l.replace(/\s*\/\/.*$/, "")).map((l) => {
    const range = l.match(/^\[\s*(\S+?)\s*,\s*(\S+?)\s*\]$/);
    return range ? { from: range[1], to: range[2] } : { from: l, to: l };
  });
}

const cache = new Map();

export function registry(name) {
  if (!cache.has(name)) cache.set(name, load(name));
  return cache.get(name);
}

async function load(name) {
  const base = `${PROXY}/${escape(name)}/@v`;
  const list = await getText(`${base}/list`);
  const latest = await getJSON(`${PROXY}/${escape(name)}/@latest`).catch(() => null);
  if (!list && !latest) return null;
  const all = [...new Set([...(list ?? "").split("\n").filter(Boolean), ...(latest ? [latest.Version] : [])])].sort(compareVersions);
  // Release times cost one request per version: fetch the newest 60.
  const recent = all.slice(-60);
  const infos = await pool(recent, 8, (v) => getJSON(`${base}/${v}.info`).catch(() => null));
  const mod = latest ? (await getText(`${base}/${latest.Version}.mod`)) ?? "" : "";
  const retracted = retractions(mod);
  const isRetracted = (v) => retracted.some((r) => compareVersions(v, r.from) >= 0 && compareVersions(v, r.to) <= 0);
  const deprecated = /\/\/\s*Deprecated:/.test(mod.split(/^module\s/m)[0]);

  // Newer majors live under another module path: probe /v(N+1), /v(N+2), ... until one is missing.
  const { base: root, major } = splitMajor(name);
  const majors = [];
  for (let n = Math.max(major, 1) + 1; n <= major + 10 && !name.startsWith("gopkg.in/"); n++) {
    const next = await getJSON(`${PROXY}/${escape(`${root}/v${n}`)}/@latest`).catch(() => null);
    if (!next) break;
    majors.push({ path: `${root}/v${n}`, latest: next.Version });
  }

  return {
    versions: all.map((v) => ({
      version: v,
      time: infos[recent.indexOf(v)]?.Time ?? null,
      yanked: isRetracted(v),
    })),
    // A "// Deprecated:" comment deprecates the whole module, not single versions.
    deprecated,
    repo: githubRepo(latest?.Origin?.URL) ?? githubRepo(name) ?? name.match(/^golang\.org\/x\/([\w-]+)/)?.[1]?.replace(/^/, "golang/") ?? null,
    majors,
  };
}

export function upgradeCommand(dep, version) {
  return `go get ${dep.name}@${version} && go mod tidy`;
}

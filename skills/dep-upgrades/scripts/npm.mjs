// npm: package.json + package-lock.json (v1-3), yarn.lock (v1 and Berry), pnpm-lock.yaml (v5-9), registry metadata.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { findFiles, getJSON, githubRepo } from "./lib.mjs";

export const ecosystem = "npm";

const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const NON_REGISTRY = /^(workspace:|file:|link:|portal:|git|github:|https?:|\.{0,2}\/)|\//;

function nearestLock(dir, root) {
  for (let d = dir; ; d = dirname(d)) {
    for (const file of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"]) {
      if (existsSync(join(d, file))) return join(d, file);
    }
    if (d === root || d === dirname(d)) return null;
  }
}

// Version of a direct dependency from the lockfile, or null when it is not locked.
export function lockedVersion(lock, name, relDir) {
  if (lock.packages) {
    const prefix = relDir ? `${relDir}/` : "";
    return lock.packages[`${prefix}node_modules/${name}`]?.version ?? lock.packages[`node_modules/${name}`]?.version ?? null;
  }
  return lock.dependencies?.[name]?.version ?? null;
}

// Every name@version in the lockfile, for the transitive vulnerability check.
export function lockedPackages(lock) {
  const out = new Map();
  if (lock.packages) {
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path.includes("node_modules/") || meta.link || !meta.version) continue;
      const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
      out.set(`${name}@${meta.version}`, { name, version: meta.version });
    }
  } else {
    const visit = (deps) => {
      for (const [name, meta] of Object.entries(deps ?? {})) {
        if (meta.version && !NON_REGISTRY.test(meta.version)) out.set(`${name}@${meta.version}`, { name, version: meta.version });
        visit(meta.dependencies);
      }
    };
    visit(lock.dependencies);
  }
  return [...out.values()];
}

// Minimal YAML reader for lockfiles: block mappings with scalar values. Lists and flow
// collections are kept as raw strings or skipped; lockfiles need nothing more.
export function parseYamlMaps(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  const unquote = (v) => (/^".*"$/.test(v) ? v.slice(1, -1).replace(/\\"/g, '"') : /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v);
  for (const line of text.split("\n")) {
    const body = line.trim();
    if (!body || body.startsWith("#") || body.startsWith("- ")) continue;
    const m = body.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?):(?:\s+(.*))?$/);
    if (!m) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).obj;
    const key = unquote(m[1]);
    if (m[2] === undefined || m[2] === "") stack.push({ indent, obj: (parent[key] = {}) });
    else parent[key] = unquote(m[2].trim());
  }
  return root;
}

// "name@spec" -> [name, spec], scoped names included.
function splitDescriptor(d) {
  const at = d.indexOf("@", 1);
  return at > 0 ? [d.slice(0, at), d.slice(at + 1)] : [d, ""];
}

// yarn.lock v1 or Berry -> {versions: Map("name@spec" -> version), packages}
export function parseYarnLock(text) {
  const versions = new Map();
  const packages = new Map();
  const add = (descriptors, version) => {
    if (!version || !/^\d/.test(version)) return;
    for (const d of descriptors) {
      const [name, rawSpec] = splitDescriptor(d.trim().replace(/^"|"$/g, ""));
      const spec = rawSpec.replace(/^npm:/, "");
      if (NON_REGISTRY.test(spec)) continue;
      versions.set(`${name}@${spec}`, version);
      packages.set(`${name}@${version}`, { name, version });
    }
  };
  if (/^__metadata:/m.test(text)) {
    for (const [key, entry] of Object.entries(parseYamlMaps(text))) {
      if (key === "__metadata" || typeof entry !== "object" || !/@npm:/.test(entry.resolution ?? "")) continue;
      add(key.split(","), entry.version);
    }
  } else {
    for (const block of text.split(/\n(?=\S)/)) {
      const header = block.split("\n")[0].match(/^(.+):\s*$/)?.[1];
      if (!header || header.startsWith("#")) continue;
      add(header.split(","), block.match(/^\s+version\s+"?([^"\s]+)"?/m)?.[1]);
    }
  }
  return { versions, packages: [...packages.values()] };
}

// pnpm lock keys and versions: "/name/1.0.0_peer" (v5), "/name@1.0.0(peer)" (v6), "name@1.0.0(peer)" (v9).
function pnpmVersion(v) {
  const clean = String(v ?? "").replace(/\(.*$/, "").replace(/_.*$/, "");
  return /^\d/.test(clean) ? clean : null;
}

function pnpmPackageKey(key) {
  const k = key.replace(/^\//, "").replace(/\(.*$/, "");
  const v5 = k.match(/^(@[^/]+\/[^/]+|[^@/][^/]*)\/(\d[^/]*)$/);
  const [name, version] = v5 ? [v5[1], v5[2]] : splitDescriptor(k);
  const clean = pnpmVersion(version);
  return clean ? { name, version: clean } : null;
}

// pnpm-lock.yaml -> {lockfileVersion, versionOf(relDir, name), packages}
export function parsePnpmLock(text) {
  const doc = parseYamlMaps(text);
  const packages = new Map();
  for (const key of Object.keys(doc.packages ?? {})) {
    const p = pnpmPackageKey(key);
    if (p) packages.set(`${p.name}@${p.version}`, p);
  }
  return {
    lockfileVersion: doc.lockfileVersion,
    versionOf(relDir, name) {
      const importer = doc.importers ? doc.importers[relDir || "."] : doc;
      for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
        const entry = importer?.[group]?.[name];
        if (entry) return pnpmVersion(typeof entry === "string" ? entry : entry.version);
      }
      return null;
    },
    packages: [...packages.values()],
  };
}

// Reads any supported lockfile into {manager, status, versionOf(key, rawSpec, relDir), packages}, or null.
function readLock(lockPath) {
  const file = lockPath.split("/").pop();
  const text = readFileSync(lockPath, "utf8");
  if (file === "package-lock.json" || file === "npm-shrinkwrap.json") {
    const lock = JSON.parse(text);
    return { manager: "npm", status: `${file} v${lock.lockfileVersion ?? 1}`, versionOf: (key, _raw, relDir) => lockedVersion(lock, key, relDir), packages: lockedPackages(lock) };
  }
  if (file === "yarn.lock") {
    const lock = parseYarnLock(text);
    const byName = (key) => [...new Set(lock.packages.filter((p) => p.name === key).map((p) => p.version))];
    return {
      manager: "yarn",
      status: `yarn.lock ${/^__metadata:/m.test(text) ? "berry" : "v1"}`,
      // Exact descriptor first; a name locked at a single version is unambiguous too.
      versionOf: (key, raw) => lock.versions.get(`${key}@${raw.replace(/^npm:/, "")}`) ?? (byName(key).length === 1 ? byName(key)[0] : null),
      packages: lock.packages,
    };
  }
  if (file === "pnpm-lock.yaml") {
    const lock = parsePnpmLock(text);
    return { manager: "pnpm", status: `pnpm-lock.yaml v${lock.lockfileVersion}`, versionOf: (key, _raw, relDir) => lock.versionOf(relDir, key), packages: lock.packages };
  }
  return null;
}

export function discover(root) {
  return findFiles(root, (f) => f === "package.json").map((manifest) => {
    const dir = dirname(manifest);
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const lockPath = nearestLock(dir, root);
    const lock = lockPath ? readLock(lockPath) : null;
    const relDir = lockPath ? relative(dirname(lockPath), dir) : "";
    const direct = [];
    const skipped = [];
    for (const [field, kind] of [["dependencies", "prod"], ["devDependencies", "dev"], ["optionalDependencies", "optional"]]) {
      for (const [key, raw] of Object.entries(pkg[field] ?? {})) {
        // Aliases ("npm:real@^1") are locked under their key but published under the real name.
        const alias = raw.startsWith("npm:") ? raw.slice(4) : null;
        const name = alias ? alias.slice(0, alias.lastIndexOf("@")) : key;
        const spec = alias ? alias.slice(alias.lastIndexOf("@") + 1) : raw;
        if (NON_REGISTRY.test(spec)) { skipped.push(key); continue; }
        direct.push({ name, spec, kind, pinned: EXACT.test(spec), version: lock ? lock.versionOf(key, raw, relDir) : null });
      }
    }
    return {
      ecosystem,
      dir: relative(root, dir) || ".",
      manifest: relative(root, manifest),
      lockfile: lockPath ? relative(root, lockPath) : null,
      lockStatus: !lockPath ? "missing" : lock ? lock.status : `unsupported lockfile ${lockPath.split("/").pop()}, versions unresolved`,
      packageManager: lock?.manager ?? "npm",
      direct,
      locked: lock?.packages ?? [],
      skipped,
    };
  });
}

const cache = new Map();

export function registry(name) {
  if (!cache.has(name)) {
    cache.set(name, getJSON(`https://registry.npmjs.org/${name.replace("/", "%2F")}`).then((doc) => doc && {
      versions: Object.entries(doc.versions ?? {}).map(([version, meta]) => ({
        version,
        time: doc.time?.[version] ?? null,
        deprecated: !!meta.deprecated,
      })),
      repo: githubRepo(typeof doc.repository === "string" ? doc.repository : doc.repository?.url) ?? githubRepo(doc.homepage),
    }));
  }
  return cache.get(name);
}

export function upgradeCommand(dep, version, proj) {
  const spec = `${dep.name}@${version}`;
  if (proj.packageManager === "yarn") return `yarn add --exact${dep.kind === "dev" ? " --dev" : dep.kind === "optional" ? " --optional" : ""} ${spec}`;
  if (proj.packageManager === "pnpm") return `pnpm add --save-exact${dep.kind === "dev" ? " --save-dev" : dep.kind === "optional" ? " --save-optional" : ""} ${spec}`;
  return `npm install --save-exact${dep.kind === "dev" ? " --save-dev" : dep.kind === "optional" ? " --save-optional" : ""} ${spec}`;
}

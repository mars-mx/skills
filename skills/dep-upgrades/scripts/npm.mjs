// npm: package.json + package-lock.json (lockfileVersion 1-3), registry metadata.
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

export function discover(root) {
  return findFiles(root, (f) => f === "package.json").map((manifest) => {
    const dir = dirname(manifest);
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const lockPath = nearestLock(dir, root);
    const lockName = lockPath?.split("/").pop();
    const lock = lockName === "package-lock.json" || lockName === "npm-shrinkwrap.json" ? JSON.parse(readFileSync(lockPath, "utf8")) : null;
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
        direct.push({ name, spec, kind, pinned: EXACT.test(spec), version: lock ? lockedVersion(lock, key, relDir) : null });
      }
    }
    return {
      ecosystem,
      dir: relative(root, dir) || ".",
      manifest: relative(root, manifest),
      lockfile: lockPath ? relative(root, lockPath) : null,
      lockStatus: !lockPath ? "missing" : lock ? `lockfile v${lock.lockfileVersion ?? 1}` : `unsupported lockfile ${lockName}, versions unresolved`,
      direct,
      locked: lock ? lockedPackages(lock) : [],
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

export function upgradeCommand(dep, version) {
  const flag = dep.kind === "dev" ? " --save-dev" : dep.kind === "optional" ? " --save-optional" : "";
  return `npm install --save-exact${flag} ${dep.name}@${version}`;
}

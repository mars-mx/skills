import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpKind, changelogSections, chooseTarget, compareVersions, severityOf, summarizeVulns, tagVersion } from "./lib.mjs";
import { lockedPackages, lockedVersion, parsePnpmLock, parseYarnLock, upgradeCommand } from "./npm.mjs";
import { parseLock, parsePyproject, parseRequirement } from "./pypi.mjs";

const NOW = Date.parse("2026-10-23T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

test("versions order across semver and PEP 440", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("3.2", "3.2.0"), 0);
  assert.equal(compareVersions("2.0.0-rc.1", "2.0.0"), -1);
  assert.equal(compareVersions("2.0rc1", "2.0b2"), 1);
  assert.equal(compareVersions("1.0.post1", "1.0"), 1);
  assert.equal(compareVersions("1.0.dev1", "1.0a1"), -1);
});

test("bump kind treats 0.x minor as major", () => {
  assert.equal(bumpKind("1.2.3", "2.0.0"), "major");
  assert.equal(bumpKind("0.3.1", "0.4.0"), "major");
  assert.equal(bumpKind("1.2.3", "1.3.0"), "minor");
  assert.equal(bumpKind("1.2.3", "1.2.4"), "patch");
});

const versions = [
  { version: "1.0.0", time: daysAgo(400) },
  { version: "1.1.0", time: daysAgo(100) },
  { version: "1.2.0", time: daysAgo(3) },
  { version: "2.0.0", time: daysAgo(30) },
  { version: "2.1.0-beta.1", time: daysAgo(1) },
  { version: "2.0.1", time: daysAgo(20), deprecated: true },
];

test("target is the newest stable release outside the cooldown", () => {
  const t = chooseTarget({ current: "1.0.0", versions, vulns: [], cooldownDays: 14, now: NOW });
  assert.equal(t.latest, "2.0.0");
  assert.equal(t.target, "2.0.0");
  assert.equal(t.inMajor, "1.1.0");
  assert.equal(t.majorsBehind, 1);
  assert.equal(t.fresh, false);
});

test("a required security fix beats the cooldown", () => {
  const t = chooseTarget({ current: "1.0.0", versions, vulns: [{ fixed: "1.2.0" }], cooldownDays: 14, now: NOW });
  assert.equal(t.target, "2.0.0");
  assert.equal(t.inMajor, "1.2.0");
  const fresh = chooseTarget({ current: "1.0.0", versions: versions.slice(0, 3), vulns: [{ fixed: "1.2.0" }], cooldownDays: 14, now: NOW });
  assert.equal(fresh.target, "1.2.0");
  assert.equal(fresh.fresh, true);
});

test("severity: malicious is critical, far behind is high, outdated is low", () => {
  assert.equal(severityOf({ vulns: [{ severity: "unknown", malicious: true }] }).severity, "critical");
  assert.equal(severityOf({ vulns: [], majorsBehind: 3 }).severity, "high");
  assert.equal(severityOf({ vulns: [{ severity: "unknown" }] }).severity, "medium");
  assert.equal(severityOf({ vulns: [], majorsBehind: 0, lagDays: 10, releasesBehind: 2 }).severity, "low");
  assert.equal(severityOf({ vulns: [], majorsBehind: 0, lagDays: 0, releasesBehind: 0 }).severity, "none");
});

test("aliased OSV records collapse into one vuln with GHSA severity and CWEs", () => {
  const pysec = { id: "PYSEC-2018-28", aliases: ["CVE-2018-18074", "GHSA-x84v-xcm2-53pg"], affected: [{ package: { name: "requests", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.20.0" }] }] }] };
  const ghsa = { id: "GHSA-x84v-xcm2-53pg", aliases: ["CVE-2018-18074", "PYSEC-2018-28"], summary: "Insufficiently Protected Credentials", database_specific: { severity: "HIGH", cwe_ids: ["CWE-522"] }, affected: pysec.affected };
  const [v, ...rest] = summarizeVulns([pysec, ghsa], { ecosystem: "PyPI", name: "requests", version: "2.19.0" });
  assert.equal(rest.length, 0);
  assert.equal(v.id, "GHSA-x84v-xcm2-53pg");
  assert.deepEqual(v.cve, ["CVE-2018-18074"]);
  assert.equal(v.severity, "high");
  assert.deepEqual(v.cwe, ["CWE-522"]);
  assert.equal(v.fixed, "2.20.0");
});

test("release tags map to versions only for the right package", () => {
  assert.equal(tagVersion("v1.2.3", "x"), "1.2.3");
  assert.equal(tagVersion("@babel/core@7.1.0", "@babel/core"), "7.1.0");
  assert.equal(tagVersion("@babel/parser@7.1.0", "@babel/core"), null);
  assert.equal(tagVersion("next@14.0.1", "next"), "14.0.1");
});

test("changelog sections split on version headings", () => {
  const s = changelogSections("# Changelog\n\n## [2.0.0] - 2026-01-01\n- BREAKING: drop node 16\n\n## 1.9.0\n- feature\n");
  assert.deepEqual(s.map((x) => x.version), ["2.0.0", "1.9.0"]);
  assert.match(s[0].body, /BREAKING/);
});

test("npm lockfile v1 and v3 resolve versions", () => {
  const v3 = { lockfileVersion: 3, packages: { "": {}, "node_modules/a": { version: "1.0.0" }, "node_modules/a/node_modules/b": { version: "2.0.0" }, "apps/web/node_modules/a": { version: "1.5.0" } } };
  assert.equal(lockedVersion(v3, "a", ""), "1.0.0");
  assert.equal(lockedVersion(v3, "a", "apps/web"), "1.5.0");
  assert.deepEqual(lockedPackages(v3).map((p) => `${p.name}@${p.version}`).sort(), ["a@1.0.0", "a@1.5.0", "b@2.0.0"]);
  const v1 = { lockfileVersion: 1, dependencies: { a: { version: "1.0.0", dependencies: { b: { version: "2.0.0" } } } } };
  assert.equal(lockedVersion(v1, "a", ""), "1.0.0");
  assert.equal(lockedPackages(v1).length, 2);
});

test("requirements lines: pins, extras, markers, options", () => {
  assert.deepEqual(parseRequirement("Django[argon2]==3.2.0 ; python_version >= '3.8'  # web"), { name: "django", spec: "==3.2.0", pinned: true, version: "3.2.0" });
  assert.deepEqual(parseRequirement("zope.interface>=5"), { name: "zope-interface", spec: ">=5", pinned: false, version: null });
  assert.equal(parseRequirement("-r base.txt"), null);
  assert.equal(parseRequirement("git+https://github.com/x/y.git"), null);
  assert.equal(parseRequirement("foo==1.*").pinned, false);
});

test("pyproject and uv.lock parsing", () => {
  const deps = parsePyproject(`[project]\nname = "x"\ndependencies = [\n  "requests[socks]>=2.0",  # http\n  "Flask==3.0.0",\n]\n\n[dependency-groups]\ndev = ["pytest>=8"]\n\n[tool.poetry.dependencies]\npython = "^3.11"\nhttpx = { version = "^0.27", extras = ["http2"] }\n`);
  assert.deepEqual(deps.map((d) => `${d.name}:${d.kind}`), ["requests:prod", "flask:prod", "pytest:optional", "httpx:prod"]);
  const lock = parseLock(`version = 1\n\n[[package]]\nname = "Requests"\nversion = "2.31.0"\nsource = { registry = "https://pypi.org/simple" }\n\n[[package]]\nname = "x"\nversion = "0.1.0"\nsource = { editable = "." }\n`);
  assert.deepEqual([...lock], [["requests", "2.31.0"]]);
});

test("malware without a fix removes the package; hijacked versions are skipped", () => {
  const whole = chooseTarget({ current: "1.0.0", versions, vulns: [{ malicious: true, fixed: null, versions: [] }], cooldownDays: 14, now: NOW });
  assert.equal(whole.remove, true);
  assert.equal(whole.target, null);
  assert.equal(whole.inMajor, null);
  const hijacked = chooseTarget({ current: "1.0.0", versions, vulns: [{ malicious: true, fixed: null, versions: ["2.0.0"] }], cooldownDays: 14, now: NOW });
  assert.equal(hijacked.remove, false);
  assert.equal(hijacked.target, "1.1.0");
});

test("yarn.lock v1 and Berry resolve descriptors and list packages", () => {
  const v1 = parseYarnLock(`# yarn lockfile v1\n\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.1.2"\n  dependencies:\n    debug "^4.1.0"\n\ndebug@^4.1.0:\n  version "4.3.4"\n`);
  assert.equal(v1.versions.get("@babel/core@^7.1.0"), "7.1.2");
  assert.deepEqual(v1.packages.map((p) => `${p.name}@${p.version}`), ["@babel/core@7.1.2", "debug@4.3.4"]);
  const berry = parseYarnLock(`__metadata:\n  version: 8\n\n"lodash@npm:4.17.20, lodash@npm:^4.17.0":\n  version: 4.17.20\n  resolution: "lodash@npm:4.17.20"\n\n"fx@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "fx@workspace:."\n`);
  assert.equal(berry.versions.get("lodash@^4.17.0"), "4.17.20");
  assert.deepEqual(berry.packages, [{ name: "lodash", version: "4.17.20" }]);
});

test("pnpm-lock v5, v6, and v9 with workspaces", () => {
  const v5 = parsePnpmLock(`lockfileVersion: 5.4\n\nspecifiers:\n  react: ^18.0.0\n\ndependencies:\n  react: 18.2.0\n\npackages:\n\n  /react/18.2.0:\n    resolution: {integrity: sha512-x}\n\n  /@types/react/18.0.1_csstype@3.0.0:\n    dev: true\n`);
  assert.equal(v5.versionOf("", "react"), "18.2.0");
  assert.deepEqual(v5.packages.map((p) => `${p.name}@${p.version}`), ["react@18.2.0", "@types/react@18.0.1"]);
  const v6 = parsePnpmLock(`lockfileVersion: '6.0'\n\nimporters:\n\n  .:\n    devDependencies:\n      typescript:\n        specifier: ^5.0.0\n        version: 5.1.3\n\n  apps/web:\n    dependencies:\n      next:\n        specifier: 14.0.1\n        version: 14.0.1(react@18.2.0)\n\npackages:\n\n  /next@14.0.1(react@18.2.0):\n    dev: false\n\n  /typescript@5.1.3:\n    dev: true\n`);
  assert.equal(v6.versionOf("", "typescript"), "5.1.3");
  assert.equal(v6.versionOf("apps/web", "next"), "14.0.1");
  assert.deepEqual(v6.packages.map((p) => `${p.name}@${p.version}`), ["next@14.0.1", "typescript@5.1.3"]);
  const v9 = parsePnpmLock(`lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      '@scope/x':\n        specifier: 1.0.0\n        version: 1.0.0\n      local:\n        specifier: workspace:*\n        version: link:packages/local\n\npackages:\n\n  '@scope/x@1.0.0':\n    resolution: {integrity: sha512-x}\n`);
  assert.equal(v9.versionOf("", "@scope/x"), "1.0.0");
  assert.equal(v9.versionOf("", "local"), null);
  assert.deepEqual(v9.packages, [{ name: "@scope/x", version: "1.0.0" }]);
});

test("upgrade command follows the package manager", () => {
  const dep = { name: "x", kind: "dev" };
  assert.equal(upgradeCommand(dep, "1.0.0", { packageManager: "pnpm" }), "pnpm add --save-exact --save-dev x@1.0.0");
  assert.equal(upgradeCommand(dep, "1.0.0", { packageManager: "yarn" }), "yarn add --exact --dev x@1.0.0");
  assert.equal(upgradeCommand(dep, "1.0.0", { packageManager: "npm" }), "npm install --save-exact --save-dev x@1.0.0");
});

test("go.mod: direct, indirect, replace, toolchain, retractions, majors", async () => {
  const { parseGoMod, retractions, splitMajor } = await import("./go.mjs");
  const mod = parseGoMod(`module example.com/fx\n\ngo 1.22\n\ntoolchain go1.22.5\n\nrequire (\n\tgithub.com/a/b v1.2.0\n\tgithub.com/c/d/v3 v3.0.1 // indirect\n\texample.com/local v0.0.0\n\tgithub.com/old/x v1.0.0\n)\n\nrequire github.com/e/f v0.4.0\n\nreplace example.com/local => ../local\n\nreplace github.com/old/x => github.com/new/x v1.1.0\n`);
  assert.equal(mod.goVersion, "1.22.5");
  assert.deepEqual(mod.requires.map((r) => `${r.name}@${r.version}${r.indirect ? " i" : ""}`),
    ["github.com/a/b@v1.2.0", "github.com/c/d/v3@v3.0.1 i", "github.com/new/x@v1.1.0", "github.com/e/f@v0.4.0"]);
  assert.deepEqual(retractions(`module x\n\nretract (\n\tv1.0.1 // broken\n\t[v1.1.0, v1.1.3]\n)\n`), [{ from: "v1.0.1", to: "v1.0.1" }, { from: "v1.1.0", to: "v1.1.3" }]);
  assert.deepEqual(splitMajor("github.com/c/d/v3"), { base: "github.com/c/d", major: 3 });
  assert.deepEqual(splitMajor("gopkg.in/yaml.v3"), { base: "gopkg.in/yaml.v3", major: 1 });
});

test("foreign alias records lend severity and CWEs, not identity", () => {
  const own = { id: "GO-2025-3563", aliases: ["CVE-2025-22871"], summary: "Request smuggling in net/http", affected: [{ package: { name: "stdlib", ecosystem: "Go" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.23.8" }] }] }] };
  const foreign = { id: "GHSA-g9pc-8g42-g6vq", aliases: ["CVE-2025-22871"], summary: "RoadRunner smuggling", database_specific: { severity: "CRITICAL", cwe_ids: ["CWE-444"] }, affected: [{ package: { name: "github.com/roadrunner-server/http/v5", ecosystem: "Go" } }] };
  const [v] = summarizeVulns([own], { ecosystem: "Go", name: "stdlib", version: "1.21.0" }, [foreign]);
  assert.equal(v.id, "GO-2025-3563");
  assert.equal(v.severity, "critical");
  assert.deepEqual(v.cwe, ["CWE-444"]);
  assert.equal(v.fixed, "1.23.8");
});

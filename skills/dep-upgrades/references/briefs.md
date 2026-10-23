# Subagent briefs

Fill in the `<placeholders>`. Every brief ends with the exact return format; ask for nothing else, so the reply stays short.

## Release-note summarizer (Haiku)

```
Summarize release notes for a dependency upgrade. Read only the files listed; do not search the web.

Packages:
- <name> <from> -> <to>: <notes file path>
...

Per package return:
### <name> <from> -> <to>
- at most 3 bullets: what changed that a user of the package notices
Breaking:
- one line per breaking change, naming the concrete API, option, default, or runtime requirement
  (example: "removed res.sendfile(), use res.sendFile()", "Node 18 required"); "none" if there is none
Security:
- one line per security fix the notes mention, with its CVE or GHSA ID if given; "none" if there is none
```

## Breaking-change searcher (Haiku)

```
Find out whether this repo uses an API that changed in a dependency upgrade. Search only; change nothing.

Package: <name> <from> -> <to>
Changes:
1. <breaking change, as the summarizer wrote it>
...

Search the source (skip node_modules, .venv, dist, build, lockfiles) for imports of <name> and for
each changed API, option, or default. Include config files and scripts that call it.

Return per change, one line:
<n>. used: <file>:<line>[, <file>:<line> ...] | unused | unsure: <why>
```

## Vulnerability analyst (Sonnet)

```
Assess whether these vulnerabilities in a dependency can be exploited in this project. Change nothing.

Package: <name> <version> (<direct | transitive via lockfile <path>>)
Vulnerabilities (from report.json):
- <id> <CVE> <severity> <CWE> fixed <version>: <summary>
...

For a transitive package, first find which direct dependency pulls it in (`npm ls <name>` or the lockfile).
Per vulnerability: find the vulnerable function or feature from the advisory, check whether this project
reaches it (directly or through the parent), and whether attacker-controlled input can reach that call
(HTTP input, uploads, env, files, CLI args).

Return per vulnerability:
<id>: exploitable | unlikely | not-reachable
  vector: <one sentence: entry point -> vulnerable call, or why none exists>
  evidence: <file>:<line> | none found
```

## Migration agent (Sonnet)

```
Upgrade <name> from <from> to <to> in this repo and adapt the code to its breaking changes.

Already applied: <the upgrade command>, committed as <sha>.
Breaking changes and where they are used:
1. <change>: <file>:<line>, ...
...
Release notes: <notes file path>

Change only what these breaking changes require. No refactors, no other upgrades.
Run <typecheck/test commands> until green. Commit as "deps: migrate <name> to <to>".

Return: the commit SHA, the files changed, and anything you could not migrate with the reason.
```

## Fixer (Sonnet)

```
A dependency upgrade broke a check. Fix the code, not the check, unless the check tests behavior the
upgrade changed on purpose.

Upgrade: <name> <from> -> <to>
Failing command: <command>
Output (trimmed): <failure output>
Release notes: <notes file path>

Return: the commit SHA and a one-line cause, or "cannot fix: <reason>".
```

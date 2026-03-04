#!/usr/bin/env node

// ─────────────────────────────────────────────────────────────────────────────
// render.mjs — Renders .wf wireframe files to SVG or HTML using @wireweave/core
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, watch,
} from 'fs';
import { join, basename, extname, resolve } from 'path';

// ─── Help text ───────────────────────────────────────────────────────────────

const HELP = `
Usage:
  render.mjs [options] <source> [output]
  render.mjs --source <path> --output <path> [options]

Renders .wf wireframe files to SVG or HTML using @wireweave/core.
<source> can be a single .wf file or a directory containing .wf files.

Options:
  -s, --source <path>    Source .wf file or directory (or first positional arg)
  -o, --output <path>    Output directory for rendered files (or second positional arg)
  -f, --format <type>    Output format: svg or html (default: svg)
  -t, --theme <name>     Theme to use for rendering (default: light)
  -w, --width <pixels>   Canvas width in pixels (default: 1200)
      --padding <pixels> Padding around the wireframe in pixels (default: 24)
      --watch            Watch source for changes and re-render automatically
  -h, --help             Show this help message and exit

Examples:
  render.mjs wireframes/src wireframes/svg
  render.mjs wireframes/src wireframes/html --format html
  render.mjs wireframes/src/login.wf wireframes/svg --theme dark
  render.mjs -s wireframes/src -o wireframes/svg -w 800
  render.mjs wireframes/src wireframes/svg --watch
`.trim();

// ─── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    source: null,
    output: null,
    format: 'svg',
    theme: 'light',
    width: 1200,
    padding: 24,
    watch: false,
    help: false,
  };

  const positional = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      i++;
      continue;
    }

    if (arg === '--watch') {
      opts.watch = true;
      i++;
      continue;
    }

    if (arg === '-s' || arg === '--source') {
      opts.source = expectValue(argv, i, arg);
      i += 2;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      opts.output = expectValue(argv, i, arg);
      i += 2;
      continue;
    }

    if (arg === '-f' || arg === '--format') {
      const val = expectValue(argv, i, arg);
      if (val !== 'svg' && val !== 'html') {
        die(`Option ${arg} must be 'svg' or 'html', got '${val}'.`);
      }
      opts.format = val;
      i += 2;
      continue;
    }

    if (arg === '-t' || arg === '--theme') {
      opts.theme = expectValue(argv, i, arg);
      i += 2;
      continue;
    }

    if (arg === '-w' || arg === '--width') {
      opts.width = expectInt(argv, i, arg);
      i += 2;
      continue;
    }

    if (arg === '--padding') {
      opts.padding = expectInt(argv, i, arg);
      i += 2;
      continue;
    }

    if (arg.startsWith('-')) {
      die(`Unknown option: ${arg}\nRun with --help for usage information.`);
    }

    positional.push(arg);
    i++;
  }

  // Positional args fill in source/output if not set via flags
  if (!opts.source && positional.length >= 1) opts.source = positional[0];
  if (!opts.output && positional.length >= 2) opts.output = positional[1];

  return opts;
}

function expectValue(argv, i, flag) {
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('-')) {
    die(`Option ${flag} requires a value.`);
  }
  return next;
}

function expectInt(argv, i, flag) {
  const raw = expectValue(argv, i, flag);
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    die(`Option ${flag} requires a positive integer, got '${raw}'.`);
  }
  return n;
}

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ─── Core resolution ─────────────────────────────────────────────────────────

function loadCore() {
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  try {
    return require('@wireweave/core');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      die(
        '@wireweave/core is not installed.\n'
        + '  Run:  npm install @wireweave/core\n'
        + '  Then try again.',
      );
    }
    throw err;
  }
}

// ─── File collection ─────────────────────────────────────────────────────────

function collectFiles(sourcePath) {
  let stat;
  try {
    stat = statSync(sourcePath);
  } catch {
    die(`Source path does not exist: ${sourcePath}`);
  }

  if (stat.isFile()) {
    if (extname(sourcePath) !== '.wf') {
      die(`Not a .wf file: ${sourcePath}`);
    }
    return [sourcePath];
  }

  if (stat.isDirectory()) {
    const files = readdirSync(sourcePath)
      .filter(f => extname(f) === '.wf')
      .map(f => join(sourcePath, f));

    if (files.length === 0) {
      die(`No .wf files found in: ${sourcePath}`);
    }
    return files;
  }

  die(`Source is neither a file nor a directory: ${sourcePath}`);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderFiles(files, outDir, core, renderOpts, format) {
  mkdirSync(outDir, { recursive: true });

  let rendered = 0;
  let errors = 0;
  const ext = format === 'html' ? '.html' : '.svg';

  for (const file of files) {
    const name = basename(file, '.wf');
    try {
      const src = readFileSync(file, 'utf-8');
      const doc = core.parse(src);
      let output;

      if (format === 'html') {
        const result = core.renderToHtml(doc, renderOpts);
        output = typeof result === 'string' ? result : result.html;
      } else {
        const result = core.renderToSvg(doc, renderOpts);
        output = typeof result === 'string' ? result : result.svg;
      }

      const outPath = join(outDir, `${name}${ext}`);
      writeFileSync(outPath, output);
      console.log(`  ${name}.wf -> ${name}${ext}`);
      rendered++;
    } catch (err) {
      console.error(`  ${name}.wf: ERROR - ${err.message}`);
      errors++;
    }
  }

  return { rendered, errors };
}

// ─── Watch mode ──────────────────────────────────────────────────────────────

function watchSource(sourcePath, run) {
  let stat;
  try {
    stat = statSync(sourcePath);
  } catch {
    die(`Cannot watch — source path does not exist: ${sourcePath}`);
  }

  const watchTarget = stat.isFile() ? sourcePath : sourcePath;

  console.log(`\nWatching for changes in: ${sourcePath}\n  Press Ctrl+C to stop.\n`);

  let debounce = null;

  watch(watchTarget, { recursive: stat.isDirectory() }, (eventType, filename) => {
    if (filename && extname(filename) !== '.wf') return;

    // Debounce rapid successive events (editors often fire multiple)
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const label = filename || sourcePath;
      console.log(`\n--- Change detected: ${label} ---`);
      run();
    }, 100);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!opts.source) {
    die('Missing required argument: <source>\nRun with --help for usage information.');
  }
  if (!opts.output) {
    die('Missing required argument: <output>\nRun with --help for usage information.');
  }

  const sourcePath = resolve(opts.source);
  const outDir = resolve(opts.output);
  const core = loadCore();

  const renderOpts = {
    theme: opts.theme,
    width: opts.width,
    padding: opts.padding,
  };

  const run = () => {
    const files = collectFiles(sourcePath);
    const { rendered, errors } = renderFiles(files, outDir, core, renderOpts, opts.format);
    console.log(`\nDone: ${rendered} rendered, ${errors} error(s)`);
    return errors;
  };

  const errors = run();

  if (opts.watch) {
    watchSource(sourcePath, run);
  } else if (errors > 0) {
    process.exit(1);
  }
}

main();

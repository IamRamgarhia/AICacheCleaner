import { bundle } from './bundle-helper.mjs';
// Tests for the logic that decides WHAT GETS DELETED.
//
// This is the highest-consequence code in the product: a mistake here removes a
// user's chat history or model weights. It previously had no test coverage at
// all, so a regression in tier classification or path de-duplication would have
// shipped silently.
//
// The pure helpers live in TypeScript, so each suite bundles them to a temp CJS
// file first (same approach as the trash regression test).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// This file is ESM, so `require` is not defined; the bundle it loads is CJS.
const require = createRequire(import.meta.url);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-safety-'));
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__safety_probe.generated.ts');
  const outfile = path.join(outDir, 'safety.cjs');

  fs.writeFileSync(
    entry,
    `export { calculateNonOverlappingSize, hasJunkExtension, formatBytes } from './scanner';\n` +
      `export { buildRestoreScript } from './restoreEngine';\n` +
      `export { describeProcess, isIdleProcess } from './processInspector';\n` +
      `export { itemsThatSkipRecycleBin } from './recycleBinLimit';\n` +
      `export { parseDockerSize } from './dockerUsage';\n`,
    'utf-8'
  );

  try {
    bundle(entry, outfile);
    lib = require(outfile);
  } finally {
    fs.rmSync(entry, { force: true });
  }
});

// Build paths with this OS's separator: the helpers use path.sep, as the app
// only ever sees native paths.
const P = (...parts) => (process.platform === 'win32' ? parts.join('\\') : '/' + parts.slice(1).join('/'));

const item = (p, sizeBytes) => ({
  id: p,
  name: p,
  category: 'Claude',
  path: p,
  sizeBytes,
  formattedSize: '',
  tier: 'GREEN',
  canDelete: true,
  impactDescription: '',
  lastModified: '2026-01-01'
});

test('nested paths are counted once, not twice', () => {
  // A parent cache and one of its children both appear in a scan. Counting both
  // would inflate the reported footprint and the "reclaimable" figure.
  const total = lib.calculateNonOverlappingSize([
    item(P('C:', 'Users', 'me', 'AppData', 'Roaming', 'Claude'), 1000),
    item(P('C:', 'Users', 'me', 'AppData', 'Roaming', 'Claude', 'Cache'), 400)
  ]);
  assert.equal(total, 1000, 'child must not be added on top of its parent');
});

test('sibling paths are both counted', () => {
  const total = lib.calculateNonOverlappingSize([
    item(P('C:', 'a', 'one'), 100),
    item(P('C:', 'a', 'two'), 250)
  ]);
  assert.equal(total, 350);
});

test('a path that merely shares a name prefix is not treated as nested', () => {
  // "Claude2" starts with "Claude" as a string but is a different directory.
  // A naive startsWith() check without the separator would swallow it.
  const total = lib.calculateNonOverlappingSize([
    item(P('C:', 'x', 'Claude'), 100),
    item(P('C:', 'x', 'Claude2'), 200)
  ]);
  assert.equal(total, 300, 'Claude2 is a sibling of Claude, not a child');
});

test('nesting comparison ignores case, as Windows paths do', { skip: process.platform === 'linux' && 'Linux paths are case-sensitive' }, () => {
  const total = lib.calculateNonOverlappingSize([
    item(P('C:', 'Users', 'Me', 'Claude'), 500),
    item(P('c:', 'users', 'me', 'claude', 'Cache'), 300)
  ]);
  assert.equal(total, 500);
});

test('empty input is zero, not NaN', () => {
  assert.equal(lib.calculateNonOverlappingSize([]), 0);
});

test('junk extensions match real extensions only', () => {
  assert.equal(lib.hasJunkExtension('holiday.jpg'), true);
  assert.equal(lib.hasJunkExtension('archive.zip'), true);
  // The original filter used a substring test, so ".ai" matched this app's own
  // data directory and any folder with ".ai" anywhere in the name.
  assert.equal(lib.hasJunkExtension('.ai-cache-cleaner'), false);
  assert.equal(lib.hasJunkExtension('my.aiproject'), false);
  assert.equal(lib.hasJunkExtension('project'), false);
});

test('byte formatting is stable at boundaries', () => {
  assert.equal(lib.formatBytes(0), '0 B');
  assert.equal(lib.formatBytes(-5), '0 B');
  assert.equal(lib.formatBytes(1024), '1 KB');
  assert.match(lib.formatBytes(1024 ** 3), /GB$/);
});

test('restore script quotes Windows paths without losing separators', () => {
  const script = lib.buildRestoreScript(['D:\\some folder\\thing']);
  assert.ok(
    script.includes("@('D:\\some folder\\thing')"),
    'backslashes and spaces must survive into the PowerShell literal'
  );
});

test("restore script escapes a single quote so it can't break out of the literal", () => {
  const script = lib.buildRestoreScript(["D:\\it's here"]);
  assert.ok(script.includes("'D:\\it''s here'"), "a quote must be doubled, not left to terminate the string");
});

// --- Process idle rule: a wrong "idle" here offers to kill a window you use ---

const proc = over => ({ memMb: 800, hasWindow: false, parentAlive: false, quietMs: 15 * 60_000, isSelf: false, ...over });

test('idle only when orphaned, windowless, quiet for 10 min and holding memory', () => {
  assert.equal(lib.isIdleProcess(proc({})), true);
  assert.equal(lib.isIdleProcess(proc({ hasWindow: true })), false, 'open editor window');
  assert.equal(lib.isIdleProcess(proc({ parentAlive: true })), false, 'child of a running app');
  assert.equal(lib.isIdleProcess(proc({ quietMs: 60_000 })), false, 'one quiet sample is not idle');
  assert.equal(lib.isIdleProcess(proc({ memMb: 40 })), false);
  assert.equal(lib.isIdleProcess(proc({ isSelf: true })), false, 'never flag this app');
});

test('process labels come from the command line', () => {
  const d = lib.describeProcess;
  assert.equal(d('claude.exe', 'C:/Program Files/WindowsApps/Claude_2/app/Claude.exe', ''), 'Claude Desktop');
  assert.equal(d('claude.exe', '', '"Claude.exe" --type=renderer'), 'Claude Desktop (helper)');
  assert.equal(d('claude.exe', '', 'c:/Users/x/.antigravity-ide/extensions/anthropic.claude-code/claude.exe --output-format stream-json'), 'Claude Code (in Antigravity)');
  assert.equal(d('node.exe', '', 'node npx-cli.js -y @upstash/context7-mcp'), 'npx launcher: @upstash/context7-mcp');
  assert.equal(d('node.exe', '', 'node D:/p/memorybridge/dist/server.js'), 'MCP server: memorybridge');
  assert.equal(d('python.exe', '', 'python.exe -m code_review_graph serve'), 'Python: code_review_graph serve');
  assert.equal(d('node.exe', '', 'node vite.js build'), 'Vite build');
  assert.equal(d('node.exe', '', 'node app.js'), 'Node.js: app.js');
  assert.equal(d('node.exe', '', 'node C:/npm-cache/_npx/98/node_modules/.bin//../@playwright/mcp/cli.js'), 'MCP server: @playwright/mcp');
  assert.equal(d('Antigravity IDE.exe', '', '"Antigravity IDE.exe" c:/p/resources/app/extensions/json-language-features/server.js'), 'Antigravity IDE extension: json-language-features');
});

// --- Recycle Bin limit: a folder too big for the bin is deleted permanently ---

const GB = 1024 ** 3;
const bin = (bytes, usedBytes = 0, nukeOnDelete = false) => ({ bytes, usedBytes, nukeOnDelete });
const refusedPaths = (items, limits) => lib.itemsThatSkipRecycleBin(items, limits).map(r => r.item.path);

test('a selection that fits the Recycle Bin is allowed', () => {
  const limits = new Map([['C:', bin(10 * GB)]]);
  assert.deepEqual(refusedPaths([{ path: 'C:/a', sizeBytes: 2 * GB }, { path: 'C:/b', sizeBytes: 3 * GB }], limits), []);
});

test('the whole selection per drive is checked, not each item alone', () => {
  // Two 5 GB items each fit a 10 GB bin, but together they would purge it.
  const limits = new Map([['C:', bin(10 * GB)]]);
  assert.deepEqual(refusedPaths([{ path: 'C:/a', sizeBytes: 5 * GB }, { path: 'C:/b', sizeBytes: 5 * GB }], limits), ['C:/a', 'C:/b']);
});

test('what is already in the bin counts against its room', () => {
  const limits = new Map([['C:', bin(10 * GB, 8 * GB)]]);
  assert.deepEqual(refusedPaths([{ path: 'C:/a', sizeBytes: 2 * GB }], limits), ['C:/a']);
});

test('drives with no bin, bin turned off, UNC and \\?\ paths are refused', () => {
  const limits = new Map([['C:', bin(10 * GB)], ['E:', bin(50 * GB, 0, true)]]);
  const paths = ['E:/stuff', 'Z:/stuff', String.raw`\\server\share\x`, String.raw`\\?\C:\x`];
  assert.deepEqual(refusedPaths(paths.map(path => ({ path, sizeBytes: 1 })), limits), paths);
});

// --- Docker reports decimal units; a wrong parse misstates the trapped space ---

test('docker sizes parse with decimal units', () => {
  assert.equal(lib.parseDockerSize('5.581GB'), 5_581_000_000);
  assert.equal(lib.parseDockerSize('115.8MB'), 115_800_000);
  assert.equal(lib.parseDockerSize('81.38kB'), 81_380);
  assert.equal(lib.parseDockerSize('0B'), 0);
  assert.equal(lib.parseDockerSize('n/a'), 0);
});

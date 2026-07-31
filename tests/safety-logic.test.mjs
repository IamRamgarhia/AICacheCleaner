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
      `export { buildRestoreScript } from './restoreEngine';\n`,
    'utf-8'
  );

  try {
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
        entry,
        '--bundle',
        '--platform=node',
        '--target=node18',
        `--outfile=${outfile}`,
        '--format=cjs'
      ],
      { cwd: repoRoot, stdio: 'pipe' }
    );
    lib = require(outfile);
  } finally {
    fs.rmSync(entry, { force: true });
  }
});

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
    item('C:\\Users\\me\\AppData\\Roaming\\Claude', 1000),
    item('C:\\Users\\me\\AppData\\Roaming\\Claude\\Cache', 400)
  ]);
  assert.equal(total, 1000, 'child must not be added on top of its parent');
});

test('sibling paths are both counted', () => {
  const total = lib.calculateNonOverlappingSize([
    item('C:\\a\\one', 100),
    item('C:\\a\\two', 250)
  ]);
  assert.equal(total, 350);
});

test('a path that merely shares a name prefix is not treated as nested', () => {
  // "Claude2" starts with "Claude" as a string but is a different directory.
  // A naive startsWith() check without the separator would swallow it.
  const total = lib.calculateNonOverlappingSize([
    item('C:\\x\\Claude', 100),
    item('C:\\x\\Claude2', 200)
  ]);
  assert.equal(total, 300, 'Claude2 is a sibling of Claude, not a child');
});

test('nesting comparison ignores case, as Windows paths do', () => {
  const total = lib.calculateNonOverlappingSize([
    item('C:\\Users\\Me\\Claude', 500),
    item('c:\\users\\me\\claude\\Cache', 300)
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

// Tests for the pieces added with the native shell / coverage / speed work:
// idle baseline, config validation, Docker reading reuse, generic app-cache
// discovery, allocated-size accounting, reminders, the Windows fast measurer,
// live folder inspection, and the real delete → Recycle Bin → restore path.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Inside the repo so the bundle can still resolve the runtime-loaded 'trash' package.
const outDir = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.aicc-test-'));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-roadmap-fx-'));
const isWin = process.platform === 'win32';
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__roadmap_probe.generated.ts');
  const outfile = path.join(outDir, 'roadmap.cjs');
  fs.writeFileSync(
    entry,
    `export { nextQuietEntry } from './processInspector';\n` +
      `export { sanitizeConfig } from './config';\n` +
      `export { reusableReading } from './dockerUsage';\n` +
      `export { scanAppCaches, appLabel } from './appCaches';\n` +
      `export { sizeOnDisk, measureDirectory } from './scanner';\n` +
      `export { fastMeasure, stopFastMeasure } from './fastMeasure';\n` +
      `export { stableId } from './ids';\n` +
      `export { inspectFolder } from './folderInspect';\n` +
      `export { deleteItemsSafely } from './snapshotManager';\n` +
      `export { restoreFromRecycleBin } from './restoreEngine';\n` +
      `export { shouldRemind } from '../src/lib/useReclaimReminder';\n`,
    'utf-8'
  );
  try {
    execFileSync(process.execPath, [
      path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'), entry,
      '--bundle', '--platform=node', '--target=node18', `--outfile=${outfile}`, '--format=cjs',
      // trash is ESM-only and loaded at runtime (see trashBridge.ts).
      '--external:trash'
    ], { cwd: repoRoot, stdio: 'pipe' });
    lib = require(outfile);
  } finally {
    fs.rmSync(entry, { force: true });
  }
});

after(() => {
  lib?.stopFastMeasure?.();
  fs.rmSync(fixtures, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
});

const write = (p, bytes = 10) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
};

// --- Idle baseline ----------------------------------------------------------

test('steady 4% CPU never counts as quiet, even though each scan gap is tiny', () => {
  let entry;
  let cpu = 100;
  for (let minute = 0; minute <= 15; minute++) {
    cpu += 0.2; // ~4% CPU between 5-second scans, added up
    entry = lib.nextQuietEntry(entry, cpu, minute * 60_000);
  }
  // The baseline reset as soon as the total passed 0.5 s, so quietSince is recent.
  assert.ok(15 * 60_000 - entry.quietSince < 60_000, `quietSince should be recent, got ${entry.quietSince}`);
});

test('a truly idle process keeps its quiet start across scans', () => {
  let entry;
  for (let minute = 0; minute <= 12; minute++) entry = lib.nextQuietEntry(entry, 42, minute * 60_000);
  assert.equal(entry.quietSince, 0);
});

test('CPU going backwards (a reused PID) restarts the quiet period', () => {
  const first = lib.nextQuietEntry(undefined, 500, 0);
  const next = lib.nextQuietEntry(first, 3, 60_000);
  assert.equal(next.quietSince, 60_000);
});

// --- Config validation --------------------------------------------------------

test('config keeps known keys only and rejects bad values', () => {
  const out = lib.sanitizeConfig({
    cacheThresholdGb: 30, restorePointPolicy: 'ALWAYS', reminderEnabled: true, reminderGb: 8,
    customRestorePath: isWin ? 'C:\\Restore' : '/tmp/restore', evil: 'x', __proto__: { polluted: true }
  });
  assert.deepEqual(Object.keys(out).sort(), ['cacheThresholdGb', 'customRestorePath', 'reminderEnabled', 'reminderGb', 'restorePointPolicy']);
  assert.deepEqual(lib.sanitizeConfig({ cacheThresholdGb: -1, restorePointPolicy: 'DELETE_ALL', reminderGb: 'lots', customRestorePath: 'relative/path' }), {});
  assert.deepEqual(lib.sanitizeConfig(null), {});
});

// --- Docker reading reuse -------------------------------------------------------

test('a remembered Docker reading is reused only while the disk file is unchanged', () => {
  const saved = { bytes: 11e9, at: 1_000 };
  assert.equal(lib.reusableReading(saved, 900), 11e9, 'file older than the reading');
  assert.equal(lib.reusableReading(saved, 2_000), null, 'file changed after the reading');
  assert.equal(lib.reusableReading(null, 900), null);
  assert.equal(lib.reusableReading(saved, 0), null, 'unknown file time: no guess');
});

// --- Generic app caches -----------------------------------------------------------

test('Chromium caches are found by profile layout, not by app name', async () => {
  const root = path.join(fixtures, 'appdata');
  const profile = path.join(root, 'SomeApp', 'User Data', 'Default');
  fs.mkdirSync(path.join(profile, 'Local Storage'), { recursive: true });
  write(path.join(profile, 'Preferences'), 10);
  fs.mkdirSync(path.join(profile, 'Network'), { recursive: true });
  write(path.join(profile, 'Cache', 'data_1'), 6 * 1024 * 1024);
  write(path.join(profile, 'Code Cache', 'js', 'x'), 6 * 1024 * 1024);
  // A folder merely named Cache, with no Chromium profile around it: ignored.
  write(path.join(root, 'Unrelated', 'Cache', 'important.db'), 6 * 1024 * 1024);
  // Our own profile is never offered.
  const own = path.join(root, 'AICacheCleaner');
  fs.mkdirSync(path.join(own, 'Local Storage'), { recursive: true });
  fs.mkdirSync(path.join(own, 'Network'), { recursive: true });
  write(path.join(own, 'Cache', 'a'), 6 * 1024 * 1024);

  const items = await lib.scanAppCaches([], [root]);
  const names = items.map(i => i.name).sort();
  assert.deepEqual(names, ['SomeApp · Default — Cache', 'SomeApp · Default — Code Cache']);
  assert.ok(items.every(i => i.tier === 'GREEN' && i.canDelete && i.evidence));

  // Inside a GREEN known item: skipped. Inside a YELLOW one: still offered.
  const green = await lib.scanAppCaches([{ path: path.join(root, 'SomeApp'), tier: 'GREEN' }], [root]);
  assert.equal(green.length, 0);
  const yellow = await lib.scanAppCaches([{ path: path.join(root, 'SomeApp'), tier: 'YELLOW' }], [root]);
  assert.equal(yellow.length, 2);
});

test('app labels read like app names', () => {
  const root = isWin ? 'C:\\L' : '/L';
  assert.equal(lib.appLabel(root, path.join(root, 'Google', 'Chrome', 'User Data', 'Default')), 'Google Chrome · Default');
  assert.equal(lib.appLabel(root, path.join(root, 'Code')), 'Code');
  assert.equal(lib.appLabel(root, path.join(root, 'WhatsApp', 'EBWebView', 'Default')), 'WhatsApp · Default');
});

// --- Sizes --------------------------------------------------------------------------

test('allocated size is used where the OS reports blocks (sparse files)', () => {
  const sparse = { size: 64 * 1024 ** 3, blocks: 2048 };
  assert.equal(lib.sizeOnDisk(sparse), isWin ? sparse.size : 2048 * 512);
  assert.equal(lib.sizeOnDisk({ size: 123 }), 123);
});

test('reminders are opt-in, need the threshold, and fire at most daily', () => {
  const on = { reminderEnabled: true, reminderGb: 5 };
  const GB = 1024 ** 3;
  const day = 24 * 3600_000;
  assert.equal(lib.shouldRemind(10 * GB, { reminderEnabled: false, reminderGb: 5 }, 0, day * 10), false);
  assert.equal(lib.shouldRemind(2 * GB, on, 0, day * 10), false);
  assert.equal(lib.shouldRemind(10 * GB, on, day * 10 - 3600_000, day * 10), false);
  assert.equal(lib.shouldRemind(10 * GB, on, 0, day * 10), true);
});

// --- Windows fast measurer --------------------------------------------------------------

test('fast measurer matches the portable walk exactly and skips junctions', { skip: !isWin }, async () => {
  const dir = path.join(fixtures, 'measure');
  write(path.join(dir, 'a.bin'), 1234);
  write(path.join(dir, 'sub', 'b.bin'), 4321);
  write(path.join(dir, 'sub', 'deep', 'c.bin'), 100_000);
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(path.join(dir, 'a.bin'), old, old);
  const outside = path.join(fixtures, 'outside');
  write(path.join(outside, 'big.bin'), 5_000_000);
  fs.symlinkSync(outside, path.join(dir, 'junction'), 'junction');

  const fast = await lib.fastMeasure(dir);
  assert.ok(fast, 'helper should be available on Windows');
  assert.equal(fast.bytes, 1234 + 4321 + 100_000, 'junction target must not be counted');
  const newest = Math.max(...['sub/b.bin', 'sub/deep/c.bin'].map(f => fs.statSync(path.join(dir, f)).mtimeMs));
  assert.ok(Math.abs(fast.newestMtimeMs - newest) < 2, `newest ${fast.newestMtimeMs} vs ${newest}`);
  // measureDirectory goes through the same helper and must agree.
  const m = await lib.measureDirectory(dir);
  assert.equal(m.bytes, fast.bytes);
});

test('live folder inspection lists entries before they are all measured', async () => {
  const dir = path.join(fixtures, 'inspect');
  write(path.join(dir, 'big', 'x.bin'), 50_000);
  write(path.join(dir, 'small.txt'), 10);
  const full = await lib.inspectFolder(dir, 10, false);
  assert.equal(full.done, true);
  assert.deepEqual(full.children.map(c => c.name), ['big', 'small.txt']);
  assert.equal(full.children[0].bytes, 50_000);
});

// --- The real delete path ----------------------------------------------------------------

test('delete goes to the Recycle Bin and restores back intact', { skip: !isWin }, async () => {
  const dir = path.join(os.tmpdir(), `aicc-roundtrip-${Date.now()}`);
  write(path.join(dir, 'keep.txt'), 64);
  const res = await lib.deleteItemsSafely([dir]);
  assert.deepEqual(res.refused, []);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.movedToTrash, [dir]);
  assert.equal(fs.existsSync(dir), false);

  const restored = await lib.restoreFromRecycleBin([dir]);
  assert.ok(restored[0]?.restored, `restore failed: ${restored[0]?.reason}`);
  assert.equal(fs.readFileSync(path.join(dir, 'keep.txt')).length, 64);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fast measurer handles non-English names and odd paths, and says so when it cannot measure', { skip: !isWin }, async () => {
  const intl = path.join(fixtures, 'Jösé 日本 Łukasz');
  write(path.join(intl, 'x.bin'), 5000);
  const r = await lib.fastMeasure(intl);
  assert.equal(r?.bytes, 5000, 'non-ASCII folder must measure, not read as 0');
  assert.equal((await lib.fastMeasure(intl.split(path.sep).join('/')))?.bytes, 5000, 'forward slashes');
  assert.equal((await lib.fastMeasure(path.join(intl, '..', path.basename(intl))))?.bytes, 5000, 'dot segments');
  // Missing folder: null (unknown), never 0 — 0 would switch off the bin check.
  assert.equal(await lib.fastMeasure(path.join(fixtures, 'does-not-exist')), null);
  // And measureDirectory still reports the truth through the fallback.
  assert.equal((await lib.measureDirectory(intl)).bytes, 5000);
});

test('item ids never collide for paths that differ only in punctuation or script', () => {
  const a = lib.stableId('model-hf', 'C:/hub/models--org--model_v1');
  const b = lib.stableId('model-hf', 'C:/hub/models--org--model-v1');
  const c = lib.stableId('appcache', 'C:/Roaming/微信/Cache');
  const d = lib.stableId('appcache', 'C:/Roaming/钉钉/Cache');
  assert.notEqual(a, b);
  assert.notEqual(c, d);
  assert.equal(lib.stableId('x', 'C:/A/B'), lib.stableId('x', 'c:/a/b'), 'case-insensitive like Windows paths');
});

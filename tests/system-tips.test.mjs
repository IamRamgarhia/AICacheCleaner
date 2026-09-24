// Tests for the Windows "system tips" report.
//
// The module only measures and describes; it must never suggest deleting a
// Windows-owned folder by hand, and a tip for a missing path must be omitted.
// It returns [] off Windows, so the whole file is skipped there.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const isWindows = process.platform === 'win32';
const skip = !isWindows && 'system tips are Windows-only';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-tips-'));
const DAY = 86_400_000;
const NOW = Date.now();
let lib;

before(() => {
  if (!isWindows) return;
  const entry = path.join(repoRoot, 'server', '__tips_probe.generated.ts');
  const outfile = path.join(outDir, 'tips.cjs');
  fs.writeFileSync(
    entry,
    `export { getSystemTips, defaultTipEnv, isOldDownload, parseDirSize } from './systemTips';\n`,
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

after(() => fs.rmSync(outDir, { recursive: true, force: true }));

/** Write `bytes` bytes to root/rel, optionally backdated by `ageDays`. */
function put(root, rel, bytes, ageDays) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
  if (ageDays !== undefined) {
    const t = new Date(NOW - ageDays * DAY);
    fs.utimesSync(file, t, t);
  }
}

/** A fake machine with every tip's path populated. */
function fakeEnv() {
  const root = fs.mkdtempSync(path.join(outDir, 'env-'));
  const drive = path.join(root, 'drive');
  const env = {
    systemDrive: drive,
    systemRoot: path.join(drive, 'Windows'),
    home: path.join(root, 'home'),
    programData: path.join(drive, 'ProgramData'),
    localAppData: path.join(root, 'home', 'AppData', 'Local'),
    now: NOW,
    drives: [drive]
  };
  put(drive, 'hiberfil.sys', 1000);
  put(drive, '$WinREAgent/Scratch/a.bin', 2000);
  put(env.systemRoot, 'SoftwareDistribution/Download/b.cab', 500);
  put(env.programData, 'NVIDIA Corporation/NVIDIA App/UpdateFramework/ota-artifacts/grd/abc/560.00-driver.exe', 3000);
  put(env.home, 'Downloads/old.zip', 4000, 200);
  put(env.home, 'Downloads/oldDir/inner.iso', 600, 200);
  put(env.home, 'Downloads/new.zip', 5000, 1);
  put(env.home, 'Downloads/edge89.bin', 70, 89);
  put(env.home, 'Downloads/desktop.ini', 80, 400);
  put(drive, '$Recycle.Bin/S-1-5-21-1/$RABC123.txt', 700);
  put(drive, '$Recycle.Bin/S-1-5-21-1/$IABC123.txt', 50);
  put(drive, '$Recycle.Bin/S-1-5-21-1/desktop.ini', 129);
  return env;
}

const byId = (tips) => Object.fromEntries(tips.map((t) => [t.id, t]));

test('measures every tip on a populated machine', { skip }, async () => {
  const tips = byId(await lib.getSystemTips(fakeEnv()));

  assert.equal(tips['hibernation-file'].bytes, 1000);
  assert.equal(tips['hibernation-file'].risk, 'medium');
  assert.deepEqual(
    tips['hibernation-file'].commands.map((c) => [c.command, c.needsAdmin]),
    [['powercfg /h /type reduced', true], ['powercfg /h off', true]]
  );

  assert.equal(tips['windows-update-leftovers'].bytes, 2500);
  assert.equal(tips['nvidia-driver-downloads'].bytes, 3000);
  assert.match(tips['nvidia-driver-downloads'].openPath, /ota-artifacts$/);

  // Recycle Bin counts only $R/$I entries, not the bin's own desktop.ini.
  assert.equal(tips['recycle-bin'].bytes, 750);
  assert.equal(tips['recycle-bin'].commands, undefined);

  // Nothing there: Delivery Optimization is omitted, not guessed.
  assert.equal(tips['delivery-optimization'], undefined);

  for (const t of Object.values(tips)) assert.ok(t.formattedSize && t.formattedSize !== '0 B');
});

test('old downloads: only entries past the 90-day cut-off, desktop.ini ignored', { skip }, async () => {
  const env = fakeEnv();
  const tip = byId(await lib.getSystemTips(env))['old-downloads'];
  // old.zip (4000) + oldDir (600). new.zip (1 day) and edge89.bin (89 days) are recent.
  assert.equal(tip.bytes, 4600);
  assert.match(tip.why, /^2 items/);
  assert.equal(tip.openPath, path.join(env.home, 'Downloads'));

  assert.equal(lib.isOldDownload(NOW - 91 * DAY, NOW), true);
  assert.equal(lib.isOldDownload(NOW - 89 * DAY, NOW), false);
  assert.equal(lib.isOldDownload(0, NOW), false, 'empty folder has no mtime and is not "old"');
});

test('tips whose paths are missing are omitted', { skip }, async () => {
  const empty = fs.mkdtempSync(path.join(outDir, 'empty-'));
  const env = {
    systemDrive: path.join(empty, 'nope'),
    systemRoot: path.join(empty, 'nope', 'Windows'),
    home: path.join(empty, 'nohome'),
    programData: path.join(empty, 'nope', 'ProgramData'),
    localAppData: path.join(empty, 'nohome', 'AppData', 'Local'),
    now: NOW,
    drives: [path.join(empty, 'nope')]
  };
  assert.deepEqual(await lib.getSystemTips(env), []);

  // Only a hibernation file present -> exactly one tip.
  put(env.systemDrive, 'hiberfil.sys', 10);
  const tips = await lib.getSystemTips(env);
  assert.deepEqual(tips.map((t) => t.id), ['hibernation-file']);
});

test('no suggested command ever deletes anything', { skip }, async () => {
  const tips = await lib.getSystemTips(fakeEnv());
  const destructive = /\b(del|erase|rm|rmdir|rd|Remove-Item|format|Clear-RecycleBin)\b/i;
  const commands = tips.flatMap((t) => (t.commands ?? []).map((c) => c.command));
  assert.ok(commands.length > 0);
  for (const cmd of commands) assert.doesNotMatch(cmd, destructive, cmd);
});

test('defaultTipEnv points at real Windows locations', { skip }, () => {
  const env = lib.defaultTipEnv();
  assert.match(env.systemDrive, /^[A-Za-z]:$/);
  assert.ok(env.systemRoot.toLowerCase().endsWith('windows'));
  assert.ok(env.drives.includes('C:'));
  assert.ok(Math.abs(env.now - Date.now()) < 60_000);
});

test('locked hiberfil.sys: size is read from a dir listing', { skip }, () => {
  // Real `dir /a /-c C:\hiberfil.sys` output; fs.stat gets EPERM on the live file.
  const listing = [
    ' Volume in drive C has no label.',
    ' Directory of C:\\',
    '',
    '23-09-2026  14:09       10217914368 hiberfil.sys',
    '               1 File(s)    10217914368 bytes'
  ].join('\r\n');
  assert.equal(lib.parseDirSize(listing, 'hiberfil.sys'), 10217914368);
  assert.equal(lib.parseDirSize(listing, 'pagefile.sys'), 0);
  assert.equal(lib.parseDirSize('09/23/2026  02:09 PM    123 HIBERFIL.SYS', 'hiberfil.sys'), 123);
  assert.equal(lib.parseDirSize('123 hiberfilXsys', 'hiberfil.sys'), 0, 'dot is literal');
});

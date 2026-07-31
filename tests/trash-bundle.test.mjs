// Regression test for the bug class that shipped in v1.0.0: the app deleted
// nothing in the packaged build because esbuild rewrote `import.meta.url` to
// `{}` inside the ESM-only `trash` package, so its helper binary was resolved
// against `undefined` and every delete threw `TypeError: Invalid URL`.
//
// The bug was invisible in dev (tsx keeps real ESM) and only appeared in the
// bundle, so this test MUST exercise the bundled output, not the TS source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-trash-test-'));

// Bundle with exactly the flags `npm run build:server` uses. If those flags
// ever regress the ESM/import.meta handling again, this test fails.
function bundle(entry, outfile) {
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
}

test('bundled trashBridge moves a real file to the Recycle Bin / Trash', async () => {
  // The probe must live inside the repo so `trash` resolves from node_modules
  // the same way `dist/server.cjs` does at runtime.
  const probeSrc = path.join(repoRoot, 'server', '__trash_probe.generated.ts');
  const probeOut = path.join(repoRoot, 'dist', '__trash_probe.generated.cjs');

  fs.mkdirSync(path.dirname(probeOut), { recursive: true });
  fs.writeFileSync(
    probeSrc,
    `import { moveToTrash } from './trashBridge';\n` +
      `moveToTrash(process.argv[2]).then(\n` +
      `  () => { process.stdout.write('OK'); },\n` +
      `  (e) => { process.stdout.write('FAIL:' + e.message); }\n` +
      `);\n`,
    'utf-8'
  );

  const victim = path.join(outDir, `victim-${process.pid}.txt`);
  fs.writeFileSync(victim, 'delete me', 'utf-8');

  try {
    bundle(probeSrc, probeOut);
    const stdout = execFileSync(process.execPath, [probeOut, victim], {
      cwd: repoRoot,
      encoding: 'utf-8'
    });

    assert.equal(stdout, 'OK', `bundled delete failed: ${stdout}`);
    assert.equal(fs.existsSync(victim), false, 'file should no longer be at its original path');
  } finally {
    fs.rmSync(probeSrc, { force: true });
    fs.rmSync(probeOut, { force: true });
    fs.rmSync(victim, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('trash stays out of the server bundle so import.meta.url survives', () => {
  const serverBundle = path.join(outDir, 'server-check.cjs');
  fs.mkdirSync(outDir, { recursive: true });
  bundle(path.join(repoRoot, 'server', 'index.ts'), serverBundle);
  const code = fs.readFileSync(serverBundle, 'utf-8');

  // The tell-tale of the original bug: esbuild inlining trash's platform module
  // and stubbing import.meta. If either string reappears, trash got bundled.
  assert.ok(
    !code.includes('windows-trash.exe'),
    'trash was inlined into the server bundle — its import.meta.url will be stubbed'
  );
  assert.ok(
    !code.includes('macos-trash'),
    'trash was inlined into the server bundle — its import.meta.url will be stubbed'
  );

  fs.rmSync(serverBundle, { force: true });
});

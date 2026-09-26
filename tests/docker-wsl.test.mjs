// Tests for the Docker & WSL breakdown.
//
// A wrong parse here misstates how much a Docker clean frees; a loose prune-kind
// check would let the API run a cleanup that destroys volumes. Docker and WSL are
// never touched: the exec function and disk paths are injected.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bundle } from './bundle-helper.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-dockerwsl-'));
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__dockerwsl_probe.generated.ts');
  const outfile = path.join(outDir, 'dockerwsl.cjs');
  fs.writeFileSync(
    entry,
    `export { parseDockerSize } from './dockerUsage';\n` +
    `export { parseDockerDf, isDockerPruneKind, getDockerBreakdown, pruneDocker } from './dockerBreakdown';\n` +
    `export { parseLxss } from './wslDistros';\n`,
    'utf-8'
  );
  try {
    bundle(entry, outfile);
    lib = require(outfile);
  } finally {
    fs.rmSync(entry, { force: true });
  }
});

after(() => fs.rmSync(outDir, { recursive: true, force: true }));

const DF = [
  '{"Active":"2","Reclaimable":"1.2GB (50%)","Size":"2.4GB","TotalCount":"5","Type":"Images"}',
  '{"Active":"1","Reclaimable":"3.4kB (12%)","Size":"28.33kB","TotalCount":"3","Type":"Containers"}',
  '{"Active":"1","Reclaimable":"0B (0%)","Size":"512MB","TotalCount":"2","Type":"Local Volumes"}',
  '{"Active":"0","Reclaimable":"1.5GB","Size":"1.5GB","TotalCount":"40","Type":"Build Cache"}',
  'not json'
].join('\r\n');

const calls = [];
const fakeExec = (stdout = '', fail = null) => async (bin, args) => {
  calls.push([bin, ...args]);
  if (fail) throw Object.assign(new Error(fail.message ?? 'boom'), fail);
  return { stdout, stderr: '' };
};

test('parseDockerSize handles Docker human sizes', () => {
  assert.equal(lib.parseDockerSize('1.2GB'), 1_200_000_000);
  assert.equal(lib.parseDockerSize('512MB'), 512_000_000);
  assert.equal(lib.parseDockerSize('3.4kB (12%)'), 3400);
  assert.equal(lib.parseDockerSize('0B'), 0);
  assert.equal(lib.parseDockerSize('2TB'), 2e12);
  assert.equal(lib.parseDockerSize(''), 0);
  assert.equal(lib.parseDockerSize('N/A'), 0);
});

test('parseDockerDf maps the four types and marks only the prunable ones', () => {
  const rows = lib.parseDockerDf(DF);
  assert.equal(rows.length, 4);
  const byType = Object.fromEntries(rows.map(r => [r.type, r]));
  assert.deepEqual(byType.Images, { type: 'Images', count: 5, active: 2, sizeBytes: 2.4e9, reclaimableBytes: 1.2e9, pruneKind: 'dangling-images' });
  assert.equal(byType['Build Cache'].pruneKind, 'build-cache');
  assert.equal(byType.Containers.pruneKind, undefined);
  assert.equal(byType['Local Volumes'].pruneKind, undefined);
  assert.equal(byType.Containers.reclaimableBytes, 3400);
});

test('isDockerPruneKind accepts exactly the two safe kinds', () => {
  assert.ok(lib.isDockerPruneKind('build-cache'));
  assert.ok(lib.isDockerPruneKind('dangling-images'));
  for (const bad of ['volumes', 'system', 'containers', 'unused-images', 'Build-Cache', ' build-cache', '', null, undefined, 1, ['build-cache'], { kind: 'build-cache' }, '__proto__', 'toString']) {
    assert.equal(lib.isDockerPruneKind(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('pruneDocker runs only the fixed commands and reads the reclaimed figure', async () => {
  calls.length = 0;
  const img = await lib.pruneDocker('dangling-images', fakeExec('Deleted Images:\nsha256:abc\n\nTotal reclaimed space: 1.2GB\n'));
  assert.deepEqual(img, { ok: true, reclaimed: '1.2GB', output: 'Deleted Images:\nsha256:abc\n\nTotal reclaimed space: 1.2GB' });
  const cache = await lib.pruneDocker('build-cache', fakeExec('ID\tRECLAIMABLE\tSIZE\nabc\ttrue\t1GB\nTotal:\t1.5GB\n'));
  assert.equal(cache.reclaimed, '1.5GB');
  assert.deepEqual(calls, [['docker', 'image', 'prune', '-f'], ['docker', 'builder', 'prune', '-f']]);

  calls.length = 0;
  const refused = await lib.pruneDocker('volumes', fakeExec());
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 0, 'a refused kind must never reach docker');
});

test('pruneDocker reports failure instead of throwing', async () => {
  const r = await lib.pruneDocker('build-cache', fakeExec('', { stderr: 'Cannot connect to the Docker daemon' }));
  assert.deepEqual(r, { ok: false, reclaimed: null, output: 'Cannot connect to the Docker daemon' });
});

test('getDockerBreakdown returns a state, never throws', async () => {
  const none = await lib.getDockerBreakdown({ exec: fakeExec('', { code: 'ENOENT' }), diskCandidates: [] });
  assert.equal(none.state, 'not-installed');
  assert.deepEqual(none.types, []);
  assert.equal(none.disk, null);

  const down = await lib.getDockerBreakdown({ exec: fakeExec('', { code: 1, stderr: 'failed to connect' }), diskCandidates: [] });
  assert.equal(down.state, 'not-running');
  assert.ok(down.manual.some(m => m.id === 'volumes' && m.severity === 'danger'));
  assert.ok(down.manual.every(m => m.commands.every(c => !/system prune|--volumes/.test(c))));
});

test('getDockerBreakdown reports the virtual disk and the space a compact returns', async () => {
  const disk = path.join(outDir, 'docker_data.vhdx');
  fs.writeFileSync(disk, Buffer.alloc(10_000));
  const ok = await lib.getDockerBreakdown({
    exec: fakeExec('{"Active":"0","Reclaimable":"0B","Size":"4kB","TotalCount":"1","Type":"Images"}'),
    diskCandidates: [path.join(outDir, 'missing.vhdx'), disk]
  });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.disk.path, disk);
  assert.equal(ok.disk.sizeBytes, 10_000);
  assert.equal(ok.disk.trappedBytes, 6_000);
  assert.match(ok.disk.compactCommand, /compact vdisk/);
});

test('parseLxss reads distros from reg query output', () => {
  const out = ['',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss',
    '    DefaultDistribution    REG_SZ    {BBBB-2}',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{aaaa-1}',
    '    DistributionName    REG_SZ    docker-desktop',
    '    Version    REG_DWORD    0x2',
    '    BasePath    REG_SZ    \\\\?\\C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\main',
    '    VhdFileName    REG_SZ    ext4.vhdx',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{bbbb-2}',
    '    DistributionName    REG_SZ    Ubuntu 22.04',
    '    Version    REG_DWORD    0x2',
    '    BasePath    REG_SZ    C:\\Users\\me\\it\'s\\Ubuntu',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{cccc-3}',
    '    DistributionName    REG_SZ    Legacy',
    '    Version    REG_DWORD    0x1',
    '    BasePath    REG_SZ    C:\\wsl1'
  ].join('\r\n');
  const [docker, ubuntu, legacy] = lib.parseLxss(out);

  assert.equal(docker.name, 'docker-desktop');
  assert.equal(docker.basePath, 'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\main');
  assert.equal(docker.vhdxPath, 'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\main\\ext4.vhdx');
  assert.equal(docker.managedByDocker, true);
  assert.equal(docker.isDefault, false);

  assert.equal(ubuntu.name, 'Ubuntu 22.04');
  assert.equal(ubuntu.isDefault, true);
  assert.equal(ubuntu.version, 2);
  assert.equal(ubuntu.managedByDocker, false);
  assert.match(ubuntu.compactCommand, /file="C:\\Users\\me\\it''s\\Ubuntu\\ext4\.vhdx"/);

  assert.equal(legacy.version, 1);
  assert.equal(legacy.vhdxPath, null);
  assert.equal(legacy.compactCommand, null);

  assert.deepEqual(lib.parseLxss(''), []);
});

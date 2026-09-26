// Tests for duplicate-model detection and project clutter finding.
//
// Both features can move multi-GB folders to the Recycle Bin, so the rules
// that REFUSE a move matter most: content-addressed blobs, the last copy of a
// model, and recently touched projects. Fixtures live under the OS temp dir
// and are passed in explicitly; the real home is never read.

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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-extras-'));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-extras-fixtures-'));
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__extras_probe.generated.ts');
  const outfile = path.join(outDir, 'extras.cjs');
  fs.writeFileSync(
    entry,
    `export { findDuplicateModels, planDuplicateTrash, withoutCopy } from './duplicateModels';\n` +
    `export { findProjectClutter, planClutterTrash } from './projectClutter';\n`,
    'utf-8'
  );
  try {
    bundle(entry, outfile);
    lib = require(outfile);
  } finally {
    fs.rmSync(entry, { force: true });
  }
});

after(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(fixtures, { recursive: true, force: true });
});

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const hex = c => c.repeat(64);
const MONTH_AGO = new Date(Date.now() - 30 * 86_400_000);
const old = (...files) => files.forEach(f => fs.utimesSync(f, MONTH_AGO, MONTH_AGO));
const blob = (fill, n) => Buffer.alloc(n, fill);

// --- Duplicate models ---

async function duplicateFixture() {
  const root = path.join(fixtures, 'dupes');
  const ollama = path.join(root, 'ollama');
  const hf = path.join(root, 'hf');
  const lms = path.join(root, 'lms');

  // Size 3000, content-addressed on both sides -> "identical" by hash.
  write(path.join(ollama, 'blobs', `sha256-${hex('b')}`), blob(2, 3000));
  write(path.join(hf, 'models--org--m', 'blobs', hex('b')), blob(2, 3000));
  write(path.join(ollama, 'manifests', 'registry.ollama.ai', 'library', 'llama', 'latest'),
    JSON.stringify({ config: { digest: `sha256:${hex('c')}` }, layers: [{ digest: `sha256:${hex('b')}` }] }));

  // Size 2000: an Ollama blob and two plain LM Studio copies of the same bytes,
  // plus one same-size file with different content that must not match.
  write(path.join(ollama, 'blobs', `sha256-${hex('a')}`), blob(1, 2000));
  write(path.join(lms, 'pub', 'm1', 'm.gguf'), blob(1, 2000));
  write(path.join(lms, 'pub', 'm2', 'm.gguf'), blob(1, 2000));
  write(path.join(lms, 'pub', 'other', 'x.gguf'), blob(9, 2000));

  // Size 4000: exactly two plain copies, used for the last-copy rule.
  write(path.join(lms, 'a', 'z', 'z.gguf'), blob(4, 4000));
  write(path.join(lms, 'b', 'z', 'z.gguf'), blob(4, 4000));

  // Below the size floor: ignored even though identical.
  write(path.join(lms, 'tiny', '1', 't.bin'), blob(5, 10));
  write(path.join(lms, 'tiny', '2', 't.bin'), blob(5, 10));

  return lib.findDuplicateModels({ ollamaModels: [ollama], huggingfaceHub: [hf], lmStudioModels: [lms] }, { minBytes: 1000 });
}

let dupes;
const groupOfSize = n => dupes.groups.find(g => g.sizeBytes === n);

test('duplicates are grouped by size then hash or sampled fingerprint', async () => {
  dupes = await duplicateFixture();
  assert.deepEqual(dupes.groups.map(g => g.sizeBytes).sort(), [2000, 3000, 4000]);

  const hashed = groupOfSize(3000);
  assert.equal(hashed.match, 'identical');
  assert.deepEqual(hashed.copies.map(c => c.store).sort(), ['Hugging Face', 'Ollama']);
  assert.equal(hashed.savingsBytes, 3000);
  assert.equal(hashed.copies.find(c => c.store === 'Ollama').modelName, 'llama:latest');

  const sampled = groupOfSize(2000);
  assert.equal(sampled.match, 'very likely identical');
  assert.equal(sampled.copies.length, 3, 'the different-content file of the same size is not a duplicate');
  assert.ok(!sampled.copies.some(c => c.path.includes('other')));
  assert.equal(sampled.savingsBytes, 4000);
});

test('content-addressed blob copies are never trashable', async () => {
  for (const copy of dupes.groups.flatMap(g => g.copies).filter(c => c.store !== 'LM Studio')) {
    assert.equal(copy.trashable, false);
    // Referenced blobs get the tool's command; an unreferenced one is Ollama's to prune.
    assert.ok(copy.command || /unreferenced blobs/.test(copy.note), 'the tool command is offered instead');
    const plan = await lib.planDuplicateTrash(dupes, copy.id);
    assert.equal(plan.ok, false);
    assert.equal(plan.status, 403);
  }
  assert.equal(groupOfSize(3000).copies.find(c => c.store === 'Ollama').command, 'ollama rm llama:latest');
});

test('a plain copy may go only while another copy remains', async () => {
  const lmCopy = groupOfSize(2000).copies.find(c => c.store === 'LM Studio');
  assert.equal((await lib.planDuplicateTrash(dupes, lmCopy.id)).ok, true);

  const [a, b] = groupOfSize(4000).copies;
  fs.rmSync(b.path);
  const plan = await lib.planDuplicateTrash(dupes, a.id);
  assert.equal(plan.ok, false);
  assert.equal(plan.status, 409);
  assert.match(plan.error, /last remaining copy/);

  const unknown = await lib.planDuplicateTrash(dupes, 'dup-0000000000000000');
  assert.equal(unknown.status, 404);

  const after = lib.withoutCopy(dupes, b.id);
  assert.equal(after.groups.some(g => g.sizeBytes === 4000), false, 'a group left with one copy disappears');
  assert.equal(after.totalSavingsBytes, dupes.totalSavingsBytes - 4000);
});

// --- Project clutter ---

async function clutterFixture() {
  const root = path.join(fixtures, 'projects');
  const p = (...s) => path.join(root, ...s);

  // Old JS project with a build script that ignores dist in git: node_modules and dist both count.
  write(p('web', 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }));
  write(p('web', '.gitignore'), 'node_modules\n/dist\n');
  write(p('web', 'src', 'index.js'), 'x');
  write(p('web', 'dist', 'out.js'), 'built');
  write(p('web', 'node_modules', 'dep', 'index.js'), 'dep');
  // Anything inside node_modules must not be searched.
  write(p('web', 'node_modules', 'dep', 'package.json'), JSON.stringify({ scripts: { build: 'x' } }));
  write(p('web', 'node_modules', 'dep', 'dist', 'a.js'), 'a');
  write(p('web', 'node_modules', 'dep', 'node_modules', 'inner', 'i.js'), 'i');
  old(p('web', 'package.json'), p('web', 'src', 'index.js'), p('web', '.gitignore'));

  // electron-builder keeps hand-made icons in build/: a build script is not enough.
  write(p('electron', 'package.json'), JSON.stringify({ scripts: { build: 'electron-builder' } }));
  write(p('electron', 'build', 'icon.ico'), 'icon');
  old(p('electron', 'package.json'));

  // A venv with nothing to rebuild it from (hand-installed wheels) stays.
  write(p('comfy', 'main.py'), 'x');
  write(p('comfy', '.git', 'HEAD'), 'ref');
  write(p('comfy', 'venv', 'pyvenv.cfg'), 'home = x');
  old(p('comfy', 'main.py'));

  // dist without a build script is left alone.
  write(p('handmade', 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
  write(p('handmade', 'dist', 'keep.txt'), 'mine');
  old(p('handmade', 'package.json'));

  // Python: venv needs pyvenv.cfg; __pycache__ is aggregated per project.
  write(p('py', 'pyproject.toml'), '[project]');
  write(p('py', '.venv', 'pyvenv.cfg'), 'home = x');
  write(p('py', 'pkg', 'a', '__pycache__', 'a.pyc'), 'c');
  write(p('py', 'pkg', 'b', '__pycache__', 'b.pyc'), 'c');
  write(p('py', 'pkg', 'a', 'mod.py'), 'x');
  old(p('py', 'pyproject.toml'), p('py', 'pkg', 'a', 'mod.py'));
  write(p('notvenv', 'venv', 'notes.txt'), 'just a folder called venv');

  // Rust: target only next to Cargo.toml.
  write(p('rs', 'Cargo.toml'), '[package]');
  write(p('rs', 'target', 'debug', 'app'), 'bin');
  old(p('rs', 'Cargo.toml'));
  write(p('java', 'target', 'classes', 'A.class'), 'x');

  // Recently edited project.
  write(p('fresh', 'package.json'), '{}');
  write(p('fresh', 'node_modules', 'd', 'x.js'), 'x');

  return { root, result: await lib.findProjectClutter([root]) };
}

let clutter;
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');

test('clutter is found only where it can be rebuilt, without descending into it', async () => {
  const { root, result } = await clutterFixture();
  clutter = { root, result };
  const found = result.items.map(i => i.paths.map(f => rel(root, f))).flat().sort();
  assert.deepEqual(found, [
    'fresh/node_modules',
    'py/.venv',
    'py/pkg/a/__pycache__',
    'py/pkg/b/__pycache__',
    'rs/target',
    'web/dist',
    'web/node_modules'
  ]);
  const pycache = result.items.find(i => i.kind === '__pycache__');
  assert.equal(pycache.paths.length, 2, '__pycache__ folders form one row per project');
  assert.equal(rel(root, pycache.projectPath), 'py');
});

test('project age ignores the clutter folders and recent projects are refused', () => {
  const { result } = clutter;
  const web = result.items.find(i => i.kind === 'node_modules' && i.projectPath.endsWith('web'));
  const fresh = result.items.find(i => i.kind === 'node_modules' && i.projectPath.endsWith('fresh'));
  assert.equal(web.recent, false, 'fresh node_modules files do not make an old project recent');
  assert.ok(web.idleDays >= 29);
  assert.equal(fresh.recent, true);

  const plan = lib.planClutterTrash(result, [web.id, fresh.id], false);
  assert.deepEqual(plan.toMove.map(i => i.id), [web.id]);
  assert.deepEqual(plan.refused.map(r => r.id), [fresh.id]);

  const forced = lib.planClutterTrash(result, [fresh.id, 'clutter-0000000000000000'], true);
  assert.deepEqual(forced.toMove.map(i => i.id), [fresh.id]);
  assert.deepEqual(forced.unknown, ['clutter-0000000000000000']);
});

test('the directory cap stops the walk and reports truncation', async () => {
  const result = await lib.findProjectClutter([clutter.root], { maxDirs: 2 });
  assert.equal(result.truncated, true);
  assert.equal(result.dirsVisited, 2);
});

test('a sampled match that differs in the middle, or whose only twin is an unused Ollama blob, is refused', async () => {
  const root = path.join(fixtures, 'dupes-strict');
  const lms = path.join(root, 'lms');
  const ollama = path.join(root, 'ollama');
  // 17 MB: the 8 MB start and end samples match, one byte in the middle differs.
  const size = 17 * 1024 * 1024;
  const a = Buffer.alloc(size, 7);
  const b = Buffer.alloc(size, 7);
  b[Math.floor(size / 2)] = 8;
  write(path.join(lms, 'x', 'ft1', 'm.gguf'), a);
  write(path.join(lms, 'x', 'ft2', 'm.gguf'), b);
  // Unreferenced blob twin (no manifest names it) of a lone LM Studio file.
  write(path.join(ollama, 'blobs', `sha256-${hex('d')}`), blob(3, 5000));
  write(path.join(ollama, 'manifests', '.keep'), '');
  write(path.join(lms, 'y', 'only', 'o.gguf'), blob(3, 5000));

  const result = await lib.findDuplicateModels({ ollamaModels: [ollama], huggingfaceHub: [], lmStudioModels: [lms] }, { minBytes: 1000 });
  const ft = result.groups.find(g => g.sizeBytes === size);
  assert.equal(ft.match, 'very likely identical');
  const refused = await lib.planDuplicateTrash(result, ft.copies[0].id);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /not identical/);

  const lone = result.groups.find(g => g.sizeBytes === 5000);
  const plain = lone.copies.find(c => c.store === 'LM Studio');
  const plan = await lib.planDuplicateTrash(result, plain.id);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /last remaining copy/);
});

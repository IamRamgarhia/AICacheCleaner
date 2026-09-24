// Tests for the Installed AI tools inventory: reading Windows' programs list,
// choosing an app's real install folder, and labelling models.
//
// A wrong answer here measures System32 as "WSL" or an installer copy as
// "Python", or calls a video model an LLM. Pure functions only; nothing on the
// real machine is read.

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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-inventory-'));
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__inventory_probe.generated.ts');
  fs.writeFileSync(entry, [
    `export { parsePrograms, cleanIconPath } from './installedPrograms';`,
    `export { isOwnFolder, outermost } from './catalogDetector';`,
    `export { modelKind, MODEL_EXT } from './aiModels';`,
    `export { CATALOG } from './aiCatalog';`
  ].join('\n'), 'utf-8');
  try {
    bundle(entry, path.join(outDir, 'inventory.cjs'));
    lib = require(path.join(outDir, 'inventory.cjs'));
  } finally {
    fs.rmSync(entry, { force: true });
  }
});

after(() => fs.rmSync(outDir, { recursive: true, force: true }));

test('installed programs: placeholders, installer icons and duplicate names are dropped', () => {
  const rows = lib.parsePrograms(JSON.stringify([
    { n: 'Python 3.14.7 (64-bit)', v: '3.14.7150.0', p: 'Python Software Foundation', l: '', i: 'C:\\Users\\me\\AppData\\Local\\Package Cache\\{x}\\python-3.14.7.exe,0', s: 187000 },
    { n: 'HP PSDr', v: '1', p: 'HP', l: '[HP_PRINTSCAN_DIR]', i: '', s: 0 },
    { n: 'Upscayl 2.15.0', v: '2.15.0', p: 'Nayam', l: '', i: '"C:\\Program Files\\Upscayl\\Upscayl.exe",0', s: 597000 },
    { n: 'upscayl 2.15.0', v: '2.15.0', p: 'dup', l: '', i: '', s: 1 }
  ]));
  assert.equal(rows.length, 3);
  const py = rows[0];
  assert.equal(py.version, '3.14.7', 'real version comes from the name');
  assert.equal(py.iconPath, undefined, 'installer copies are not the app');
  assert.equal(py.estimatedBytes, 187000 * 1024);
  assert.equal(rows[1].installLocation, undefined);
  assert.equal(rows[2].iconPath, 'C:\\Program Files\\Upscayl\\Upscayl.exe');
});

test('single program object (PowerShell unwraps one-element arrays) still parses', () => {
  assert.equal(lib.parsePrograms(JSON.stringify({ n: 'Git', v: '2.55.0', l: 'C:\\Program Files\\Git\\' }))[0].installLocation, 'C:\\Program Files\\Git');
});

test('icon paths: only real executables', () => {
  assert.equal(lib.cleanIconPath('C:\\x\\app.ico'), undefined);
  assert.equal(lib.cleanIconPath('C:\\Windows\\Installer\\{g}\\icon.exe'), undefined);
  assert.equal(lib.cleanIconPath('"C:\\x\\a.exe",-101'), 'C:\\x\\a.exe');
});

test('install folders: never System32, Program Files itself, home, or an installer copy', { skip: process.platform !== 'win32' }, () => {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  assert.equal(lib.isOwnFolder(path.join(sysRoot, 'System32')), false);
  assert.equal(lib.isOwnFolder(process.env.ProgramFiles || 'C:\\Program Files'), false);
  assert.equal(lib.isOwnFolder(os.homedir()), false);
  assert.equal(lib.isOwnFolder('C:\\Program Files\\NVIDIA Corporation\\Installer2\\Display.Driver.{1}'), false);
  assert.equal(lib.isOwnFolder('C:\\Program Files\\Docker\\Docker'), true);
});

test('outermost keeps one folder per tree and ignores case', () => {
  const sep = path.sep;
  const a = path.resolve(`${sep}tools${sep}node`);
  const got = lib.outermost([a, path.join(a, 'node_modules'), a.toUpperCase(), path.resolve(`${sep}other`)]);
  assert.equal(got.length, 2);
});

test('model kinds: video, speech, LoRA, upscaler, image and LLM are told apart', () => {
  assert.equal(lib.modelKind('ComfyUI/models/diffusion_models', 'wan2.1_t2v_14B.safetensors'), 'Video model');
  assert.equal(lib.modelKind('.cache/whisper', 'large-v3.pt'), 'Speech & audio model');
  assert.equal(lib.modelKind('models/loras', 'style.safetensors'), 'LoRA adapter');
  assert.equal(lib.modelKind('Upscayl/resources/models', 'remacri-4x.bin'), 'Upscaling model');
  assert.equal(lib.modelKind('models/checkpoints', 'sdxl_base.safetensors'), 'Image model');
  assert.equal(lib.modelKind('downloads', 'qwen2.5-7b-instruct-q4_k_m.gguf'), 'Language model (LLM)');
  assert.ok(lib.MODEL_EXT.test('x.gguf') && lib.MODEL_EXT.test('x.safetensors') && !lib.MODEL_EXT.test('x.txt'));
});

test('catalog: every entry has a unique id and a way to be found', () => {
  const ids = lib.CATALOG.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of lib.CATALOG) assert.ok(e.program || e.exe, `${e.id} needs a program name or an executable`);
  // The Python matcher must not swallow the launcher.
  const py = lib.CATALOG.find(e => e.id === 'tc-python');
  assert.ok(py.program.test('Python 3.14.7 (64-bit)'));
  assert.ok(!py.program.test('Python Launcher'));
});

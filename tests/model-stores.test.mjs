// Tests for the per-model listing of local model stores.
//
// A wrong result here points the user at the wrong multi-GB folder, or offers a
// raw delete of Ollama blobs that other models still need. Fixtures are built
// under the OS temp dir and passed in explicitly; the real home is never read.

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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-models-'));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-model-fixtures-'));
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__model_probe.generated.ts');
  const outfile = path.join(outDir, 'models.cjs');

  fs.writeFileSync(
    entry,
    `export { scanModelStores, defaultModelStoreRoots, parseHubDirName, manifestDigests, ollamaDisplayName } from './modelStores';\n`,
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

after(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(fixtures, { recursive: true, force: true });
});

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const bytes = n => Buffer.alloc(n, 1);
const hex = c => c.repeat(64);
const none = { huggingfaceHub: [], ollamaModels: [], lmStudioModels: [] };
const scan = roots => lib.scanModelStores({ ...none, ...roots });
const byName = items => Object.fromEntries(items.map(i => [i.name, i]));

// --- Hugging Face hub ---

test('hub model and dataset dirs become one item each, sized from their files', async () => {
  const hub = path.join(fixtures, 'hf');
  write(path.join(hub, 'models--meta-llama--Llama-3-8B', 'blobs', 'a'), bytes(300));
  write(path.join(hub, 'models--meta-llama--Llama-3-8B', 'refs', 'main'), bytes(40));
  write(path.join(hub, 'datasets--squad--v2', 'blobs', 'b'), bytes(120));
  write(path.join(hub, 'models--gpt2', 'blobs', 'c'), bytes(10));
  write(path.join(hub, 'models--empty--thing', 'refs', '.keep'), '');
  write(path.join(hub, 'version.txt'), '1');
  fs.mkdirSync(path.join(hub, '.locks'), { recursive: true });

  const items = byName(await scan({ huggingfaceHub: [hub] }));
  assert.deepEqual(Object.keys(items).sort(), [
    'Hugging Face dataset: squad/v2',
    'Hugging Face model: gpt2',
    'Hugging Face model: meta-llama/Llama-3-8B'
  ]);

  const llama = items['Hugging Face model: meta-llama/Llama-3-8B'];
  assert.equal(llama.sizeBytes, 340);
  assert.equal(llama.category, 'HuggingFace');
  assert.equal(llama.tier, 'YELLOW');
  assert.equal(llama.canDelete, true);
  assert.equal(llama.manualCommand, 'huggingface-cli delete-cache');
  assert.match(llama.impactDescription, /re-download/);
  assert.match(llama.evidence, /huggingface_hub/);
  assert.match(llama.id, /^model-hf-/);
  assert.match(llama.lastModified, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(llama.idleDays, 0);
  assert.equal(llama.path, path.join(hub, 'models--meta-llama--Llama-3-8B'));
  assert.equal(items['Hugging Face dataset: squad/v2'].sizeBytes, 120);
});

test('ids are stable across scans', async () => {
  const hub = path.join(fixtures, 'hf-stable');
  write(path.join(hub, 'models--a--b', 'x'), bytes(5));
  const [first] = await scan({ huggingfaceHub: [hub] });
  const [second] = await scan({ huggingfaceHub: [hub] });
  assert.equal(first.id, second.id);
});

// --- Ollama ---

function ollamaStore(dir) {
  const blob = (c, n) => write(path.join(dir, 'blobs', `sha256-${hex(c)}`), bytes(n));
  const manifest = (parts, digests) => write(
    path.join(dir, 'manifests', ...parts),
    JSON.stringify({
      schemaVersion: 2,
      config: { digest: `sha256:${hex(digests[0])}` },
      layers: digests.slice(1).map(c => ({ digest: `sha256:${hex(c)}`, size: 1 }))
    })
  );
  blob('a', 100);  // config of llama3
  blob('b', 1000); // weights shared by llama3 and the namespaced fork
  blob('c', 50);
  blob('d', 7);
  // 'e' is referenced but its blob is missing.
  manifest(['registry.ollama.ai', 'library', 'llama3', 'latest'], ['a', 'b']);
  manifest(['registry.ollama.ai', 'someone', 'llama3-tuned', '8b'], ['c', 'b', 'e']);
  manifest(['example.com', 'team', 'coder', 'v1'], ['d']);
  write(path.join(dir, 'manifests', 'registry.ollama.ai', 'library', 'broken', 'latest'), '{not json');
  manifest(['registry.ollama.ai', 'library', 'ghost', 'latest'], ['e']);
  return dir;
}

test('ollama manifests become one item per model:tag with blob-summed size', async () => {
  const store = ollamaStore(path.join(fixtures, 'ollama'));
  const items = byName(await scan({ ollamaModels: [store] }));

  // broken JSON and an all-missing-blob manifest are skipped, not thrown.
  assert.deepEqual(Object.keys(items).sort(), [
    'Ollama model: example.com/team/coder:v1',
    'Ollama model: llama3:latest',
    'Ollama model: someone/llama3-tuned:8b'
  ]);

  const llama = items['Ollama model: llama3:latest'];
  assert.equal(llama.sizeBytes, 1100);
  assert.equal(llama.canDelete, false, 'blobs are shared; raw deletion would corrupt other models');
  assert.equal(llama.manualCommand, 'ollama rm llama3:latest');
  assert.match(llama.impactDescription, /ollama rm llama3:latest/);
  assert.match(llama.impactDescription, /shared with other models/);
  assert.equal(llama.category, 'Ollama');
  assert.equal(llama.tier, 'YELLOW');
  assert.equal(llama.path, path.join(store, 'manifests', 'registry.ollama.ai', 'library', 'llama3', 'latest'));

  const tuned = items['Ollama model: someone/llama3-tuned:8b'];
  assert.equal(tuned.sizeBytes, 1050, 'missing blob e is skipped, not counted');
  assert.equal(tuned.manualCommand, 'ollama rm someone/llama3-tuned:8b');

  const coder = items['Ollama model: example.com/team/coder:v1'];
  assert.equal(coder.sizeBytes, 7);
  assert.doesNotMatch(coder.impactDescription, /shared/);
  assert.equal(coder.manualCommand, 'ollama rm example.com/team/coder:v1');
});

test('ollama names with shell metacharacters are never turned into commands', async () => {
  const dir = path.join(fixtures, 'ollama-evil');
  write(path.join(dir, 'blobs', `sha256-${hex('f')}`), bytes(9));
  write(
    path.join(dir, 'manifests', 'registry.ollama.ai', 'library', 'x&calc', 'latest'),
    JSON.stringify({ config: { digest: `sha256:${hex('f')}` }, layers: [] })
  );
  assert.deepEqual(await scan({ ollamaModels: [dir] }), []);
});

test('manifest digests reject anything that is not a sha256 hex digest', () => {
  const json = JSON.stringify({
    config: { digest: `sha256:${hex('a')}` },
    layers: [{ digest: '../../etc/passwd' }, { digest: `sha256:${hex('a')}` }, {}, { digest: `sha256:${hex('b')}` }]
  });
  assert.deepEqual(lib.manifestDigests(json), [hex('a'), hex('b')]);
  assert.throws(() => lib.manifestDigests('{oops'));
});

test('ollama display names', () => {
  assert.equal(lib.ollamaDisplayName('registry.ollama.ai', 'library', 'qwen', '7b'), 'qwen:7b');
  assert.equal(lib.ollamaDisplayName('registry.ollama.ai', 'me', 'qwen', '7b'), 'me/qwen:7b');
  assert.equal(lib.ollamaDisplayName('hf.co', 'org', 'm', 'q4'), 'hf.co/org/m:q4');
});

// --- LM Studio ---

test('lm studio publisher/model dirs become one item each', async () => {
  const root = path.join(fixtures, 'lmstudio');
  write(path.join(root, 'lmstudio-community', 'Qwen-7B-GGUF', 'model.Q4.gguf'), bytes(400));
  write(path.join(root, 'lmstudio-community', 'Qwen-7B-GGUF', 'model.Q8.gguf'), bytes(600));
  write(path.join(root, 'bartowski', 'Phi-3-GGUF', 'phi.gguf'), bytes(80));
  fs.mkdirSync(path.join(root, 'bartowski', 'Empty'), { recursive: true });
  write(path.join(root, 'stray.txt'), 'x');

  const items = byName(await scan({ lmStudioModels: [root] }));
  assert.deepEqual(Object.keys(items).sort(), [
    'LM Studio model: bartowski/Phi-3-GGUF',
    'LM Studio model: lmstudio-community/Qwen-7B-GGUF'
  ]);
  const qwen = items['LM Studio model: lmstudio-community/Qwen-7B-GGUF'];
  assert.equal(qwen.sizeBytes, 1000);
  assert.equal(qwen.category, 'LM Studio');
  assert.equal(qwen.canDelete, true);
  assert.equal(qwen.tier, 'YELLOW');
  assert.match(qwen.impactDescription, /LM Studio/);
  assert.equal(qwen.path, path.join(root, 'lmstudio-community', 'Qwen-7B-GGUF'));
});

// --- Empty / missing ---

test('missing and empty roots return nothing', async () => {
  const empty = path.join(fixtures, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const missing = path.join(fixtures, 'does-not-exist');
  assert.deepEqual(await scan({}), []);
  assert.deepEqual(
    await scan({ huggingfaceHub: [missing, empty], ollamaModels: [missing, empty], lmStudioModels: [missing, empty] }),
    []
  );
});

test('default roots come from the environment', () => {
  const saved = { HF_HUB_CACHE: process.env.HF_HUB_CACHE, HF_HOME: process.env.HF_HOME, OLLAMA_MODELS: process.env.OLLAMA_MODELS };
  try {
    delete process.env.HF_HUB_CACHE;
    process.env.HF_HOME = path.join(fixtures, 'hfhome');
    process.env.OLLAMA_MODELS = path.join(fixtures, 'om');
    const roots = lib.defaultModelStoreRoots();
    assert.deepEqual(roots.huggingfaceHub, [path.join(fixtures, 'hfhome', 'hub')]);
    assert.deepEqual(roots.ollamaModels, [path.join(fixtures, 'om')]);
    process.env.HF_HUB_CACHE = path.join(fixtures, 'direct');
    assert.deepEqual(lib.defaultModelStoreRoots().huggingfaceHub, [path.join(fixtures, 'direct')]);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import type { AISoftwareAppItem } from '../src/types';
import { formatBytes, measureDirectory } from './scanner';
import { mapLimit, pathExists, readdirSafe } from './fsAsync';
import { stableId } from './ids';

/**
 * Libraries and CLIs that AI tools install: global npm packages, AI Python
 * libraries, and uv / pipx tools. Read straight from their folders — no
 * `npm ls` or `pip list`, which each take seconds to start.
 */
const home = os.homedir();
const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

const NPM_LABELS: Record<string, [string, string]> = {
  '@anthropic-ai/claude-code': ['Claude Code', 'Anthropic\'s coding agent CLI.'],
  '@openai/codex': ['Codex CLI', 'OpenAI\'s coding agent CLI.'],
  '@google/gemini-cli': ['Gemini CLI', 'Google\'s coding agent CLI.'],
  '@qwen-code/qwen-code': ['Qwen Code', 'Alibaba\'s coding agent CLI.'],
  'opencode-ai': ['OpenCode', 'Open-source coding agent CLI.'],
  '@kilocode/cli': ['Kilo Code CLI', 'Coding agent CLI.'],
  '@playwright/mcp': ['Playwright MCP', 'MCP server that lets agents drive a browser.'],
  'chrome-devtools-mcp': ['Chrome DevTools MCP', 'MCP server that lets agents inspect Chrome.'],
  'agent-browser': ['agent-browser', 'Browser automation CLI for AI agents.'],
  'antigravity-claude-proxy': ['antigravity-claude-proxy', 'Proxy that routes Claude requests through Antigravity.'],
  'task-master-ai': ['Task Master', 'AI task planner for coding agents.'],
  '@railway/cli': ['Railway CLI', 'Deploys apps; agents use it to ship.'],
  vercel: ['Vercel CLI', 'Deploys apps; agents use it to ship.']
};

// Python distributions that are AI libraries (normalised: lowercase, "-" → "_").
const AI_PYTHON = /^(torch(vision|audio)?|tensorflow.*|keras|jax(lib)?|transformers|diffusers|accelerate|peft|huggingface_hub|hf_xet|safetensors|tokenizers|sentence_transformers|datasets|onnx|onnxruntime(_gpu|_directml)?|openai|anthropic|google_genai|google_generativeai|langchain.*|langgraph.*|llama_index.*|llama_cpp_python|ollama|tiktoken|gradio(_client)?|mcp|fastmcp|crawl4ai|playwright|rembg|chromadb|faiss.*|lancedb|qdrant_client|pinecone.*|litellm|instructor|pydantic_ai.*|crewai.*|(py)?autogen.*|dspy.*|vllm|bitsandbytes|xformers|triton|openai_whisper|faster_whisper|ctranslate2|spacy|nltk|scikit_learn|ultralytics|timm|opencv_python.*|mediapipe|code_review_graph|graphify)$/;

const packageItem = (id: string, name: string, category: string, description: string, dir: string, bytes: number, version: string | undefined, manualCommand: string): AISoftwareAppItem => ({
  id, name, category, description, group: 'package', status: 'INSTALLED ON DISK', detectionPaths: [dir],
  version: version ? `v${version}` : undefined, totalDiskSizeBytes: bytes, formattedDiskSize: formatBytes(bytes),
  canUninstall: false, manualCommand
});

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}

/** Global node_modules folders for the Node installs we know about. */
export function npmGlobalRoots(nodeRoots: string[]): string[] {
  if (process.platform === 'win32') return [path.join(roaming, 'npm', 'node_modules')];
  return [...nodeRoots.map(r => path.join(r, '..', 'lib', 'node_modules')), '/usr/local/lib/node_modules', path.join(home, '.npm-global', 'lib', 'node_modules')];
}

async function npmPackages(roots: string[]): Promise<AISoftwareAppItem[]> {
  const dirs: { name: string; dir: string }[] = [];
  for (const root of [...new Set(roots.map(r => path.resolve(r)))]) {
    for (const e of await readdirSafe(root)) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (!e.name.startsWith('@')) { dirs.push({ name: e.name, dir: path.join(root, e.name) }); continue; }
      for (const s of await readdirSafe(path.join(root, e.name))) {
        if (s.isDirectory()) dirs.push({ name: `${e.name}/${s.name}`, dir: path.join(root, e.name, s.name) });
      }
    }
  }
  return mapLimit(dirs.filter(d => d.name !== 'npm' && d.name !== 'corepack'), 4, async ({ name, dir }) => {
    const pkg = await readJson(path.join(dir, 'package.json'));
    const [label, what] = NPM_LABELS[name] ?? [name, typeof pkg?.description === 'string' ? pkg.description : 'Global npm package.'];
    const { bytes } = await measureDirectory(dir);
    return packageItem(`npm-${name}`, label, `npm global · ${name}`, what, dir, bytes,
      typeof pkg?.version === 'string' ? pkg.version : undefined, `npm uninstall -g ${name}`);
  });
}

/** site-packages folders for the given Python install roots plus per-user sites. */
export async function sitePackageDirs(pythonRoots: string[]): Promise<string[]> {
  const out = pythonRoots.flatMap(r => [path.join(r, 'Lib', 'site-packages'), path.join(r, 'lib', 'site-packages')]);
  const userBase = process.platform === 'win32' ? path.join(roaming, 'Python') : path.join(home, '.local', 'lib');
  for (const e of await readdirSafe(userBase)) if (e.isDirectory()) out.push(path.join(userBase, e.name, 'site-packages'));
  // Lib and lib are the same folder on Windows and macOS.
  const caseless = process.platform !== 'linux';
  const unique = [...new Map(out.map(p => [caseless ? path.resolve(p).toLowerCase() : path.resolve(p), path.resolve(p)])).values()];
  const existing: string[] = [];
  for (const d of unique) if (await pathExists(d)) existing.push(d);
  return existing;
}

async function pythonPackages(sites: string[]): Promise<AISoftwareAppItem[]> {
  const found: { name: string; version: string; site: string; folders: string[] }[] = [];
  for (const site of sites) {
    for (const e of await readdirSafe(site)) {
      const m = e.name.match(/^(.+?)-([^-]+)\.dist-info$/);
      if (!e.isDirectory() || !m) continue;
      const norm = m[1].toLowerCase().replace(/[-.]/g, '_');
      if (!AI_PYTHON.test(norm)) continue;
      let top: string[] = [];
      try { top = (await fsp.readFile(path.join(site, e.name, 'top_level.txt'), 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(Boolean); } catch { /* optional */ }
      if (top.length === 0) top = [norm];
      // Native wheels keep their DLLs in "<name>.libs" beside the package.
      const folders = [...top, ...top.map(t => `${t}.libs`)].map(t => path.join(site, t));
      found.push({ name: m[1], version: m[2], site, folders });
    }
  }
  return mapLimit(found, 4, async ({ name, version, site, folders }) => {
    let bytes = 0;
    let dir = site;
    for (const f of folders) {
      if (!(await pathExists(f))) continue;
      if (dir === site) dir = f;
      bytes += (await measureDirectory(f)).bytes;
    }
    return packageItem(stableId('py', path.join(site, name)), name, 'Python library', 'Python library AI tools and scripts import.', dir, bytes, version, `pip uninstall ${name}`);
  });
}

/** Tools installed with `uv tool install` or `pipx install`, one venv each. */
async function isolatedTools(): Promise<AISoftwareAppItem[]> {
  const roots: [string, string, (n: string) => string][] = [
    [path.join(roaming, 'uv', 'tools'), 'uv tool', n => `uv tool uninstall ${n}`],
    [path.join(home, '.local', 'share', 'uv', 'tools'), 'uv tool', n => `uv tool uninstall ${n}`],
    [path.join(home, '.local', 'pipx', 'venvs'), 'pipx tool', n => `pipx uninstall ${n}`],
    [path.join(home, 'pipx', 'venvs'), 'pipx tool', n => `pipx uninstall ${n}`]
  ];
  const tools: { name: string; dir: string; kind: string; cmd: string }[] = [];
  for (const [root, kind, cmd] of roots) {
    for (const e of await readdirSafe(root)) if (e.isDirectory() && !e.name.startsWith('.')) tools.push({ name: e.name, dir: path.join(root, e.name), kind, cmd: cmd(e.name) });
  }
  return mapLimit(tools, 4, async t => {
    const { bytes } = await measureDirectory(t.dir);
    return packageItem(stableId('tool', t.dir), t.name, t.kind, `Installed as an isolated ${t.kind}.`, t.dir, bytes, undefined, t.cmd);
  });
}

export async function detectAIPackages(nodeRoots: string[], pythonRoots: string[]): Promise<AISoftwareAppItem[]> {
  const [npm, py, tools] = await Promise.all([
    npmPackages(npmGlobalRoots(nodeRoots)),
    sitePackageDirs(pythonRoots).then(pythonPackages),
    isolatedTools()
  ]);
  return [...npm, ...tools, ...py].filter(p => p.totalDiskSizeBytes > 0);
}

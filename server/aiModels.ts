import path from 'path';
import os from 'os';
import type { AICacheItem, AISoftwareAppItem, SoftwareChild } from '../src/types';
import { formatBytes } from './scanner';
import { mapLimit, pathExists, readdirSafe, statSafe } from './fsAsync';
import { scanModelStores } from './modelStores';
import { listDrives } from './drives';
import { stableId } from './ids';

/**
 * AI models on this machine — language, image, video, speech and vision
 * weights — wherever the usual tools keep them: the Ollama / Hugging Face /
 * LM Studio stores (via modelStores.ts), image and video UIs (ComfyUI,
 * A1111/Forge, Fooocus, InvokeAI, Stability Matrix, Pinokio), and the model
 * caches of libraries such as Whisper, rembg and PyTorch.
 */
const home = os.homedir();
const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const pf = process.env.ProgramFiles || 'C:\\Program Files';

export const MODEL_EXT = /\.(safetensors|ckpt|gguf|ggml|pt|pth|bin|onnx|sft|param|pb|tflite|mlmodel|h5)$/i;

/** Model caches at fixed places: [owner, folder]. */
const KNOWN_MODEL_DIRS: [string, string][] = [
  ['Upscayl', path.join(pf, 'Upscayl', 'resources', 'models')],
  ['Upscayl', path.join(local, 'Programs', 'Upscayl', 'resources', 'models')],
  ['Whisper', path.join(home, '.cache', 'whisper')],
  ['rembg', path.join(home, '.u2net')],
  ['PyTorch hub', path.join(home, '.cache', 'torch', 'hub', 'checkpoints')],
  ['Sentence Transformers', path.join(home, '.cache', 'torch', 'sentence_transformers')],
  ['GPT4All', path.join(local, 'nomic.ai', 'GPT4All')],
  ['Jan', path.join(roaming, 'Jan', 'data', 'models')],
  ['Jan', path.join(home, 'jan', 'models')],
  ['Msty', path.join(roaming, 'Msty', 'models')],
  ['InsightFace', path.join(home, '.insightface', 'models')],
  ['DeepFace', path.join(home, '.deepface', 'weights')],
  ['EasyOCR', path.join(home, '.EasyOCR', 'model')],
  ['Keras', path.join(home, '.keras', 'models')],
  ['CLIP', path.join(home, '.cache', 'clip')],
  ['Stability Matrix', path.join(roaming, 'StabilityMatrix', 'Models')],
  ['InvokeAI', path.join(home, 'invokeai', 'models')],
  ['Pinokio', path.join(home, 'pinokio', 'api')]
];

/** Folders of image / video / LLM apps people install anywhere (C:\ComfyUI, D:\AI\Forge…). */
const MODEL_APP = /^(comfyui(_windows_portable)?|stable-diffusion-webui(-forge|-reforge)?|sd-webui[\w-]*|forge|fooocus|invokeai|stabilitymatrix|swarmui|automatic|sd\.next|text-generation-webui|koboldcpp|llama\.cpp|localai|kohya_ss|onetrainer|fluxgym|wan2gp|facefusion|applio|rvc[\w-]*|pinokio|ollama-models|models)$/i;

export function modelKind(where: string, file = ''): string {
  const s = `${where} ${file}`.toLowerCase();
  if (/wan2?|ltx|hunyuan.?video|animatediff|cogvideo|mochi|\bsvd\b|video/.test(s)) return 'Video model';
  if (/whisper|\btts\b|audio|rvc|voice|speech|bark|kokoro|musicgen/.test(s)) return 'Speech & audio model';
  if (/lora|lycoris/.test(s)) return 'LoRA adapter';
  if (/upscal|esrgan|upscayl|remacri|ultrasharp/.test(s)) return 'Upscaling model';
  if (/controlnet|t2i.?adapter|ipadapter/.test(s)) return 'Image control model';
  if (/\bvae\b|[\\/]vae/.test(s)) return 'VAE';
  if (/clip|text.?encoder|t5xxl/.test(s)) return 'Text encoder';
  if (/embed|sentence.?transformers|bge|e5-/.test(s)) return 'Embedding model';
  if (/u2net|rembg|insightface|deepface|easyocr|yolo|sam\b|segment|detect|face/.test(s)) return 'Vision model';
  if (/stable.?diffusion|sdxl|sd3|flux|checkpoint|unet|diffusion|diffusers|dreamshaper|pony|illustrious/.test(s)) return 'Image model';
  if (/\.gguf$|ggml|llama|qwen|mistral|gemma|phi|deepseek|mixtral|gpt/.test(s)) return 'Language model (LLM)';
  return 'AI model';
}

interface ModelFile { name: string; path: string; bytes: number }

/** Model files under `dir`, bounded so a huge tree can't stall the scan. */
async function walkModels(dir: string, minBytes: number, maxDepth = 5): Promise<ModelFile[]> {
  const out: ModelFile[] = [];
  let visited = 0;
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited++ > 4000) return;
    for (const e of await readdirSafe(d)) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/^(\.git|node_modules|venv|\.venv|__pycache__|site-packages)$/i.test(e.name)) await walk(full, depth + 1);
      } else if (e.isFile() && MODEL_EXT.test(e.name)) {
        const st = await statSafe(full);
        if (st && st.size >= minBytes) out.push({ name: e.name, path: full, bytes: st.size });
      }
    }
  };
  await walk(dir, 0);
  return out;
}

/** Folders of model apps, searched two levels deep in the usual places and every drive root. */
async function findModelApps(): Promise<string[]> {
  const drives = (await listDrives()).map(d => d.root);
  const roots = [home, path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Downloads'), roaming, local, path.join(local, 'Programs'), ...drives];
  const found = new Set<string>();
  const look = async (dir: string, depth: number) => {
    for (const e of await readdirSafe(dir)) {
      if (!e.isDirectory() || /^(\$|windows$|program files|programdata|appdata$|system volume)/i.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (MODEL_APP.test(e.name) && e.name.toLowerCase() !== 'models') found.add(full);
      else if (depth < 1) await look(full, depth + 1);
    }
  };
  await mapLimit([...new Set(roots)], 4, r => look(r, 0));
  return [...found];
}

const row = (id: string, name: string, category: string, dir: string, bytes: number, children?: SoftwareChild[], manualCommand?: string): AISoftwareAppItem => ({
  id, name, category, group: 'model', status: 'INSTALLED ON DISK', detectionPaths: [dir],
  totalDiskSizeBytes: bytes, formattedDiskSize: formatBytes(bytes), canUninstall: false,
  description: manualCommand
    ? 'A downloaded model. Remove it with its own tool so nothing that still uses it breaks.'
    : 'Model files on disk. Delete from the app that downloaded them, or from All locations after checking nothing uses them.',
  children, manualCommand
});

/** One row per folder of model files, e.g. "ComfyUI · checkpoints". */
function folderRows(owner: string, base: string, files: ModelFile[]): AISoftwareAppItem[] {
  const byFolder = new Map<string, ModelFile[]>();
  for (const f of files) {
    const folder = path.dirname(f.path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), f]);
  }
  return [...byFolder].map(([folder, list]) => {
    const rel = path.relative(base, folder) || path.basename(folder);
    const bytes = list.reduce((a, f) => a + f.bytes, 0);
    const kinds = new Set(list.map(f => modelKind(folder, f.name)));
    return row(stableId('model', folder), `${owner} · ${rel.replace(/\\/g, '/')}`, kinds.size === 1 ? [...kinds][0] : 'AI models', folder, bytes,
      list.sort((a, b) => b.bytes - a.bytes).map(f => ({ name: f.name, detail: modelKind(folder, f.name), sizeBytes: f.bytes, path: f.path })));
  });
}

/** Store models (Ollama, Hugging Face, LM Studio) as one row each. */
function storeRows(items: AICacheItem[]): AISoftwareAppItem[] {
  return items.map(i => {
    const name = i.name.replace(/^(Ollama|LM Studio|Hugging Face)( model| dataset)?:\s*/i, '');
    const kind = /dataset/i.test(i.name) ? 'Dataset' : i.category === 'Ollama' && !/embed/i.test(name) ? 'Language model (LLM)' : modelKind(name);
    return row(i.id, name, `${kind} · ${i.category}`, i.path, i.sizeBytes, undefined, (i as AICacheItem & { manualCommand?: string }).manualCommand);
  });
}

export async function detectAIModels(): Promise<AISoftwareAppItem[]> {
  const [stores, apps] = await Promise.all([scanModelStores().catch(() => [] as AICacheItem[]), findModelApps()]);
  const known: [string, string][] = [];
  for (const [owner, dir] of KNOWN_MODEL_DIRS) if (await pathExists(dir)) known.push([owner, dir]);

  const fromKnown = await mapLimit(known, 3, async ([owner, dir]) => folderRows(owner, dir, await walkModels(dir, 1024 * 1024)));
  const fromApps = await mapLimit(apps, 3, async dir => {
    const base = (await pathExists(path.join(dir, 'models'))) ? path.join(dir, 'models') : dir;
    return folderRows(path.basename(dir), base, await walkModels(base, 20 * 1024 * 1024));
  });
  const rows = [...storeRows(stores), ...fromKnown.flat(), ...fromApps.flat()].filter(r => r.totalDiskSizeBytes > 0);
  // The same folder can be reached from two roots (e.g. Pinokio inside home).
  return [...new Map(rows.map(r => [r.detectionPaths[0].toLowerCase(), r])).values()];
}

import path from 'path';
import os from 'os';

/**
 * Software AI work depends on, beyond the AI apps themselves: apps with AI
 * built in, and the runtimes, containers, databases, drivers and browsers that
 * AI tools install or drive. Found from Windows' installed-programs list and
 * from PATH, so anything installed the normal way is recognised.
 */
export type CatalogGroup = 'ai' | 'ai-feature' | 'toolchain';

export interface CatalogEntry {
  id: string;
  name: string;
  group: CatalogGroup;
  category: string;
  usedFor: string;
  /** Matched against the names Windows lists under Settings > Apps. */
  program?: RegExp;
  /** Several installed programs fold into one row (.NET runtimes, VC++ redistributables). */
  aggregate?: boolean;
  /** Executables looked up on PATH (and in knownDirs) when not in the programs list. */
  exe?: string[];
  knownDirs?: string[];
  /** Install root from an executable path (e.g. strip "\bin"). */
  rootFrom?: (exePath: string) => string;
  /** Settings, caches and data the app keeps outside its install folder. */
  dataDirs?: string[];
  /** Process names (without .exe) that mean it's running. */
  running?: RegExp;
}

const home = os.homedir();
const pf = process.env.ProgramFiles || 'C:\\Program Files';
const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const parentOf = (levels: number) => (p: string) => path.resolve(path.dirname(p), ...Array(levels).fill('..'));

const AI_APPS: CatalogEntry[] = [
  { id: 'app-zcode', name: 'ZCode', group: 'ai', category: 'AI coding app · Z.ai', program: /^zcode\b/i, running: /^zcode$/i,
    dataDirs: [path.join(roaming, 'ZCode'), path.join(home, '.zcode')], usedFor: 'Z.ai desktop coding agent running GLM models.' },
  { id: 'app-upscayl', name: 'Upscayl', group: 'ai', category: 'AI image upscaler · Upscayl', program: /^upscayl/i, running: /^upscayl$/i,
    dataDirs: [path.join(roaming, 'Upscayl')], usedFor: 'Upscales images with AI models that run on your GPU.' },
  { id: 'app-wispr', name: 'Wispr Flow', group: 'ai', category: 'AI dictation · Wispr', program: /^wispr flow/i, running: /^wispr ?flow$/i,
    dataDirs: [path.join(roaming, 'Wispr Flow'), path.join(local, 'WisprFlow')], usedFor: 'Voice dictation that rewrites speech with AI in any app.' },
  { id: 'app-grammarly', name: 'Grammarly', group: 'ai', category: 'AI writing assistant · Grammarly', program: /^grammarly/i, running: /^grammarly/i,
    dataDirs: [path.join(local, 'Grammarly'), path.join(roaming, 'Grammarly')], usedFor: 'AI writing suggestions and rewrites in every app.' },
  { id: 'app-lmstudio', name: 'LM Studio', group: 'ai', category: 'Local model runner · LM Studio', program: /^lm ?studio/i, running: /^lm ?studio$/i,
    dataDirs: [path.join(home, '.lmstudio'), path.join(home, '.cache', 'lm-studio')], usedFor: 'Downloads and runs open models locally.' },
  { id: 'app-chatgpt', name: 'ChatGPT', group: 'ai', category: 'Assistant · OpenAI', program: /^chatgpt/i, running: /^chatgpt$/i, usedFor: 'OpenAI desktop assistant.' },
  { id: 'app-perplexity', name: 'Perplexity', group: 'ai', category: 'AI search · Perplexity', program: /^perplexity/i, running: /^perplexity$/i, usedFor: 'AI answer engine desktop app.' },
  { id: 'app-windsurf', name: 'Windsurf', group: 'ai', category: 'AI code editor · Windsurf', program: /^windsurf/i, running: /^windsurf$/i, usedFor: 'AI code editor with the Cascade agent.' },
  { id: 'app-trae', name: 'Trae', group: 'ai', category: 'AI code editor · ByteDance', program: /^trae\b/i, running: /^trae$/i, usedFor: 'AI code editor.' },
  { id: 'app-kiro', name: 'Kiro', group: 'ai', category: 'AI code editor · AWS', program: /^kiro\b/i, running: /^kiro$/i, usedFor: 'Spec-driven agentic code editor.' },
  { id: 'app-zed', name: 'Zed', group: 'ai', category: 'AI code editor · Zed', program: /^zed\b/i, running: /^zed$/i, usedFor: 'Code editor with built-in AI agents.' },
  { id: 'app-warp', name: 'Warp', group: 'ai', category: 'AI terminal · Warp', program: /^warp\b/i, running: /^warp$/i, usedFor: 'Terminal with a built-in AI agent.' },
  { id: 'app-gpt4all', name: 'GPT4All', group: 'ai', category: 'Local model runner · Nomic', program: /^gpt4all/i, running: /^chat$/i, usedFor: 'Runs open models locally.' },
  { id: 'app-msty', name: 'Msty', group: 'ai', category: 'Local model runner · Msty', program: /^msty/i, running: /^msty$/i, usedFor: 'Chat with local and online models.' },
  { id: 'app-pinokio', name: 'Pinokio', group: 'ai', category: 'AI app launcher · Pinokio', program: /^pinokio/i, running: /^pinokio$/i,
    dataDirs: [path.join(home, 'pinokio')], usedFor: 'One-click installer for local AI apps; each app keeps its own models.' },
  { id: 'app-stability', name: 'Stability Matrix', group: 'ai', category: 'Image generation · Stability Matrix', program: /^stability ?matrix/i,
    running: /^stabilitymatrix$/i, usedFor: 'Manages Stable Diffusion UIs and their models.' },
  { id: 'app-comfyui', name: 'ComfyUI', group: 'ai', category: 'Image generation · Comfy', program: /^comfyui/i, running: /^comfyui$/i, usedFor: 'Node-based image and video generation.' },
  { id: 'app-eigent', name: 'Eigent', group: 'ai', category: 'Multi-agent desktop · Eigent', program: /^eigent/i, running: /^eigent$/i,
    dataDirs: [path.join(roaming, 'eigent')], usedFor: 'Desktop workforce of cooperating AI agents.' },
  { id: 'app-openwork', name: 'OpenWork', group: 'ai', category: 'Agent desktop · Different AI', program: /^openwork/i, running: /^openwork$/i,
    dataDirs: [path.join(roaming, 'com.differentai.openwork'), path.join(local, 'com.differentai.openwork')], usedFor: 'Desktop app for running agent workflows.' },
  { id: 'app-opencode-desktop', name: 'OpenCode', group: 'ai', category: 'Coding agent · OpenCode', program: /^opencode/i, running: /^opencode/i,
    dataDirs: [path.join(roaming, 'ai.opencode.desktop'), path.join(local, 'ai.opencode.desktop'), path.join(home, '.local', 'share', 'opencode'), path.join(home, '.cache', 'opencode')],
    usedFor: 'Open-source coding agent (terminal and desktop).' }
];

const AI_FEATURE_APPS: CatalogEntry[] = [
  { id: 'feat-photoshop', name: 'Adobe Photoshop', group: 'ai-feature', category: 'Generative Fill · Adobe', program: /^adobe photoshop/i, running: /^photoshop$/i,
    usedFor: 'Generative Fill and Expand (Firefly) — its scratch disk and caches can grow large.' },
  { id: 'feat-wps', name: 'WPS Office', group: 'ai-feature', category: 'WPS AI · Kingsoft', program: /^wps office/i, running: /^wps$/i, usedFor: 'Office suite with WPS AI writing and summaries.' },
  { id: 'feat-powertoys', name: 'PowerToys', group: 'ai-feature', category: 'Advanced Paste · Microsoft', program: /^powertoys/i, running: /^powertoys/i,
    usedFor: 'Advanced Paste can reformat clipboard content with AI.' },
  { id: 'feat-edge', name: 'Microsoft Edge', group: 'ai-feature', category: 'Copilot · Microsoft', program: /^microsoft edge$/i, running: /^msedge$/i,
    usedFor: 'Copilot sidebar; also the WebView many AI desktop apps run inside.' },
  { id: 'feat-chrome', name: 'Google Chrome', group: 'ai-feature', category: 'Gemini in Chrome · Google', program: /^google chrome$/i, running: /^chrome$/i,
    usedFor: 'Gemini in Chrome; agents drive it too (Claude in Chrome, Chrome DevTools MCP).' },
  { id: 'feat-brave', name: 'Brave', group: 'ai-feature', category: 'Leo AI · Brave', program: /^brave$/i, running: /^brave$/i, usedFor: 'Browser with the Leo AI assistant.' },
  { id: 'feat-opera', name: 'Opera', group: 'ai-feature', category: 'Aria AI · Opera', program: /^opera( stable)?\b/i, running: /^opera$/i, usedFor: 'Browser with the Aria AI assistant.' },
  { id: 'feat-office', name: 'Microsoft 365', group: 'ai-feature', category: 'Copilot · Microsoft', program: /^microsoft (365|office)/i, running: /^(winword|excel|powerpnt)$/i,
    usedFor: 'Office apps with Copilot built in.' }
];

const TOOLCHAIN: CatalogEntry[] = [
  { id: 'tc-docker', name: 'Docker Desktop', group: 'toolchain', category: 'Containers · Docker', program: /^docker desktop/i,
    exe: ['Docker Desktop.exe', 'docker.exe', 'docker'], knownDirs: [path.join(pf, 'Docker', 'Docker')],
    rootFrom: p => (/docker desktop\.exe$/i.test(p) ? path.dirname(p) : parentOf(2)(p)),
    dataDirs: [path.join(local, 'Docker', 'wsl', 'disk', 'docker_data.vhdx'), path.join(local, 'Docker', 'wsl', 'data', 'ext4.vhdx')],
    running: /^(docker desktop|com\.docker\.backend|vmmemwsl)$/i,
    usedFor: 'Runs containers for MCP servers, local models, databases and dev stacks. All its data lives in one virtual disk, included in the size.' },
  { id: 'tc-wsl', name: 'WSL', group: 'toolchain', category: 'Linux on Windows · Microsoft', program: /^windows subsystem for linux/i,
    exe: ['wsl.exe'], knownDirs: [path.join(pf, 'WSL')], rootFrom: p => path.dirname(p), running: /^vmmemwsl$/i,
    usedFor: 'The Linux layer Docker Desktop and many AI dev setups run on.' },
  { id: 'tc-node', name: 'Node.js', group: 'toolchain', category: 'JavaScript runtime', program: /^node\.js/i,
    exe: ['node.exe', 'node'], knownDirs: [path.join(pf, 'nodejs')], rootFrom: p => path.dirname(p), running: /^node$/i,
    dataDirs: [path.join(roaming, 'npm')], usedFor: 'Runs most MCP servers, agent CLIs and npx-based AI tools. Size includes global npm packages.' },
  { id: 'tc-python', name: 'Python', group: 'toolchain', category: 'Python runtime', program: /^python \d+\.\d+(\.\d+)? \(/i, aggregate: true,
    exe: ['python.exe', 'python3'], rootFrom: p => path.dirname(p), running: /^pythonw?$/i,
    usedFor: 'Runs local models, notebooks, crawlers and Python MCP servers. Size includes installed libraries.' },
  { id: 'tc-git', name: 'Git', group: 'toolchain', category: 'Version control', program: /^git( version)? ?[\d.]*$/i,
    exe: ['git.exe', 'git'], knownDirs: [path.join(pf, 'Git')],
    rootFrom: p => p.match(/^(.*?)[\\/](?:cmd|bin|mingw64[\\/]bin)[\\/]git(?:\.exe)?$/i)?.[1] ?? path.dirname(p),
    usedFor: 'Coding agents use it to read, branch and commit your code.' },
  { id: 'tc-gh', name: 'GitHub CLI', group: 'toolchain', category: 'GitHub', program: /^github cli/i, exe: ['gh.exe', 'gh'], rootFrom: p => path.dirname(p),
    usedFor: 'Agents use it to open pull requests and read issues.' },
  { id: 'tc-uv', name: 'uv', group: 'toolchain', category: 'Python package manager · Astral', exe: ['uv.exe', 'uv'], rootFrom: p => path.dirname(p),
    dataDirs: [path.join(local, 'uv'), path.join(roaming, 'uv')], usedFor: 'Installs Python tools and MCP servers (uvx). Size includes its cache.' },
  { id: 'tc-bun', name: 'Bun', group: 'toolchain', category: 'JavaScript runtime · Oven', exe: ['bun.exe', 'bun'], rootFrom: parentOf(1), running: /^bun$/i,
    usedFor: 'JavaScript runtime some agent CLIs ship with.' },
  { id: 'tc-pnpm', name: 'pnpm', group: 'toolchain', category: 'Package manager', exe: ['pnpm.exe', 'pnpm.cmd', 'pnpm'], rootFrom: p => path.dirname(p),
    usedFor: 'Package manager; its shared store is listed under Storage.' },
  { id: 'tc-java', name: 'Java', group: 'toolchain', category: 'Java runtime', program: /^(java \d|java\(tm\)|openjdk|eclipse temurin|microsoft build of openjdk|amazon corretto)/i,
    aggregate: true, exe: ['java.exe', 'java'], rootFrom: parentOf(1), running: /^javaw?$/i,
    usedFor: 'Needed by some language servers, Gradle/Maven builds and Android tooling.' },
  { id: 'tc-go', name: 'Go', group: 'toolchain', category: 'Go toolchain', program: /^go programming language/i, exe: ['go.exe', 'go'],
    knownDirs: [path.join(pf, 'Go', 'bin')], rootFrom: parentOf(1), usedFor: 'Builds Go-based CLIs and MCP servers.' },
  { id: 'tc-rust', name: 'Rust', group: 'toolchain', category: 'Rust toolchain (rustup)', exe: ['rustc.exe', 'rustc'],
    rootFrom: () => path.join(home, '.rustup'), dataDirs: [path.join(home, '.cargo')], usedFor: 'Builds Rust-based AI tools; toolchains live in ~/.rustup.' },
  { id: 'tc-dotnet', name: '.NET', group: 'toolchain', category: 'Runtimes · Microsoft', program: /^microsoft (\.net|asp\.net core|windows desktop runtime)/i, aggregate: true,
    exe: ['dotnet.exe', 'dotnet'], knownDirs: [path.join(pf, 'dotnet')], rootFrom: p => path.dirname(p),
    usedFor: 'Runtime for .NET apps, tools and some language servers.' },
  { id: 'tc-vcredist', name: 'Visual C++ Redistributables', group: 'toolchain', category: 'Runtime libraries · Microsoft',
    program: /^microsoft visual c\+\+ .*redistributable/i, aggregate: true,
    usedFor: 'Native libraries Python AI packages (PyTorch, onnxruntime) and many desktop apps need.' },
  { id: 'tc-vscode', name: 'Visual Studio Code', group: 'toolchain', category: 'Editor · Microsoft', program: /^microsoft visual studio code/i,
    exe: ['Code.exe', 'code.cmd', 'code'], knownDirs: [path.join(local, 'Programs', 'Microsoft VS Code'), path.join(pf, 'Microsoft VS Code')],
    rootFrom: p => (/[\\/]bin[\\/]code(\.cmd)?$/i.test(p) ? parentOf(1)(p) : path.dirname(p)), running: /^code$/i,
    usedFor: 'Editor hosting Copilot, Cline, Continue and other AI extensions.' },
  { id: 'tc-postgres', name: 'PostgreSQL', group: 'toolchain', category: 'Database', program: /^postgresql/i, running: /^postgres$/i,
    usedFor: 'Database AI apps and agents use; pgvector stores embeddings.' },
  { id: 'tc-nvidia', name: 'NVIDIA GPU driver', group: 'toolchain', category: 'GPU · NVIDIA', program: /^nvidia graphics driver/i,
    usedFor: 'Lets local models (Ollama, LM Studio, PyTorch) run on the GPU through CUDA.' },
  { id: 'tc-cuda', name: 'CUDA Toolkit', group: 'toolchain', category: 'GPU · NVIDIA', program: /^nvidia cuda (toolkit|development|runtime)/i, aggregate: true,
    usedFor: 'Compiler and libraries for GPU AI workloads. Several versions side by side can take many GB.' }
];

export const CATALOG: CatalogEntry[] = [...AI_APPS, ...AI_FEATURE_APPS, ...TOOLCHAIN];

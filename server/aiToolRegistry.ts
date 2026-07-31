import path from 'path';
import os from 'os';
import { readdirSafe } from './fsAsync';

/**
 * AI tool discovery.
 *
 * The detector used to be a hardcoded table of 13 tools with fixed paths, so a
 * machine with Antigravity IDE, Codex, GLM, Kimi, Cline, Windsurf or anything
 * else simply showed nothing for them — including a 1.2 GB `~/.antigravity`
 * directory sitting right next to the `.gemini` folder it did know about.
 *
 * Now we DISCOVER: walk the handful of places desktop AI tools install into,
 * match directory names against vendor/product signatures, then enrich anything
 * we recognise with a friendly name. Unknown-but-matching directories are still
 * reported (labelled from their folder name) rather than hidden, because "we
 * found 1.2 GB belonging to something called antigravity" is far more useful
 * than silence.
 */

const home = os.homedir();
const appDataLocal = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const appDataRoaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';

/** Places desktop AI tooling actually installs to. */
export const SEARCH_ROOTS = [
  home,
  appDataRoaming,
  appDataLocal,
  path.join(appDataLocal, 'Programs'),
  programFiles,
  path.join(home, '.cache'),
  path.join(home, '.config')
];

/**
 * Signatures matched against a directory name (lowercased, leading dot
 * stripped). Deliberately specific: a loose list would sweep in unrelated
 * folders and the tool list would become noise.
 */
const TOOL_SIGNATURES: { match: RegExp; name: string; vendor: string; kind: string }[] = [
  { match: /^(anthropic)?claude/, name: 'Claude', vendor: 'Anthropic', kind: 'Assistant & agent CLI' },
  { match: /^cursor/, name: 'Cursor', vendor: 'Anysphere', kind: 'AI code editor' },
  { match: /^antigravity/, name: 'Antigravity', vendor: 'Google', kind: 'Agentic IDE' },
  { match: /^gemini/, name: 'Gemini', vendor: 'Google', kind: 'Assistant' },
  { match: /^(chat)?glm|^zhipu|^bigmodel/, name: 'GLM', vendor: 'Zhipu AI', kind: 'Model provider' },
  { match: /^kimi|^moonshot/, name: 'Kimi', vendor: 'Moonshot AI', kind: 'Assistant' },
  { match: /^codex/, name: 'Codex', vendor: 'OpenAI', kind: 'Agent CLI' },
  { match: /^openai/, name: 'OpenAI tools', vendor: 'OpenAI', kind: 'Model provider' },
  { match: /^copilot|^github-copilot/, name: 'GitHub Copilot', vendor: 'GitHub', kind: 'Code assistant' },
  { match: /^ollama/, name: 'Ollama', vendor: 'Ollama', kind: 'Local model runner' },
  { match: /^lm-?studio/, name: 'LM Studio', vendor: 'LM Studio', kind: 'Local model runner' },
  { match: /^jan$/, name: 'Jan', vendor: 'Jan', kind: 'Local model runner' },
  { match: /^anythingllm/, name: 'AnythingLLM', vendor: 'Mintplex', kind: 'RAG workspace' },
  { match: /^continue/, name: 'Continue', vendor: 'Continue', kind: 'Code assistant' },
  { match: /^cline|^roo-?(cline|code)/, name: 'Cline', vendor: 'Cline', kind: 'Coding agent' },
  { match: /^windsurf/, name: 'Windsurf', vendor: 'Codeium', kind: 'AI code editor' },
  { match: /^trae/, name: 'Trae', vendor: 'ByteDance', kind: 'AI code editor' },
  { match: /^codegeex/, name: 'CodeGeeX', vendor: 'Zhipu AI', kind: 'Code assistant' },
  { match: /^aider/, name: 'Aider', vendor: 'Aider', kind: 'Coding agent' },
  { match: /^opendevin|^openhands/, name: 'OpenHands', vendor: 'OpenHands', kind: 'Autonomous agent' },
  { match: /^crawl4ai/, name: 'Crawl4AI', vendor: 'Crawl4AI', kind: 'Crawler' },
  { match: /^ms-playwright|^playwright/, name: 'Playwright browsers', vendor: 'Microsoft', kind: 'Headless browsers' },
  { match: /^puppeteer/, name: 'Puppeteer browsers', vendor: 'Google', kind: 'Headless browsers' },
  { match: /^huggingface/, name: 'Hugging Face cache', vendor: 'Hugging Face', kind: 'Model weights' },
  { match: /^torch$/, name: 'PyTorch cache', vendor: 'PyTorch', kind: 'Model weights' },
  { match: /^deepseek/, name: 'DeepSeek', vendor: 'DeepSeek', kind: 'Model provider' },
  { match: /^qwen/, name: 'Qwen', vendor: 'Alibaba', kind: 'Model provider' },
  { match: /^opencode/, name: 'OpenCode', vendor: 'OpenCode', kind: 'Coding agent' },
  { match: /^zed$/, name: 'Zed', vendor: 'Zed', kind: 'AI code editor' },
  { match: /^void$/, name: 'Void', vendor: 'Void', kind: 'AI code editor' },
  { match: /^(c)?agents?$/, name: 'Agent workspace', vendor: 'Unknown', kind: 'Coding agent' },
  { match: /^mcp/, name: 'MCP servers', vendor: 'Model Context Protocol', kind: 'Tool servers' }
];

/** Directories that look AI-ish by name but are this app's own, or noise. */
const EXCLUDE = /^(ai-cache-cleaner|ai-hygiene|npm|cache|config|local|ssh|docker|bun|chocolatey)$/;

export interface DiscoveredTool {
  /** Stable id derived from the product name. */
  id: string;
  name: string;
  vendor: string;
  kind: string;
  paths: string[];
  /** True when the folder name matched a known signature. */
  recognised: boolean;
}

function normalizeDirName(dirName: string): string {
  return dirName.replace(/^\./, '').toLowerCase().trim();
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/**
 * Walk the search roots one level deep and group every AI-looking directory
 * under the product it belongs to.
 */
export async function discoverAITools(): Promise<DiscoveredTool[]> {
  const byProduct = new Map<string, DiscoveredTool>();

  for (const root of SEARCH_ROOTS) {
    const entries = await readdirSafe(root);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const normalized = normalizeDirName(entry.name);
      if (!normalized || EXCLUDE.test(normalized)) continue;

      const signature = TOOL_SIGNATURES.find(s => s.match.test(normalized));
      if (!signature) continue;

      const fullPath = path.join(root, entry.name);
      const id = `tool-${signature.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      const existing = byProduct.get(id);
      if (existing) {
        if (!existing.paths.includes(fullPath)) existing.paths.push(fullPath);
      } else {
        byProduct.set(id, {
          id,
          name: signature.name,
          vendor: signature.vendor,
          kind: signature.kind,
          paths: [fullPath],
          recognised: true
        });
      }
    }
  }

  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export { titleCase };

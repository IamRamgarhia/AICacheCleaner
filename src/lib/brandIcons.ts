import {
  siAnthropic, siClaude, siOllama, siHuggingface, siDocker, siPython, siNodedotjs, siGit, siGithub, siGooglechrome, siBrave,
  siOpera, siDotnet, siGo, siRust, siBun, siPnpm, siNpm, siCursor, siGooglegemini, siPostgresql, siNvidia, siGrammarly,
  siWindsurf, siLmstudio, siPerplexity, siVercel, siRailway, siModelcontextprotocol, siPytorch, siOnnx, siGradio, siWarp,
  siUbuntu, siLinux, siUv, siCline, siGithubcopilot, siDeepseek, siQwen, siKimi, siZdotai, siPuppeteer, siLangchain,
  siMistralai, siOpenjdk, siReplicate, siDeno, siTauri, siGoogle
} from 'simple-icons';

/**
 * Official brand marks (Simple Icons, CC0) for things that have no .exe to
 * take an icon from: CLIs, model stores, packages, data folders.
 */
interface Brand { path: string; hex: string }

const BRANDS: [RegExp, Brand][] = [
  [/claude|anthropic/i, siClaude],
  [/ollama/i, siOllama],
  [/hugging ?face|\bhf_xet\b/i, siHuggingface],
  [/docker|cagent/i, siDocker],
  [/pytorch|\btorch\b/i, siPytorch],
  [/onnx/i, siOnnx],
  [/gradio/i, siGradio],
  [/langchain|langgraph/i, siLangchain],
  [/\bmcp\b|model context protocol|fastmcp/i, siModelcontextprotocol],
  [/python/i, siPython],
  [/node\.?js/i, siNodedotjs],
  [/github cli|\bgh\b/i, siGithub],
  [/copilot/i, siGithubcopilot],
  [/^git\b/i, siGit],
  [/chrome/i, siGooglechrome],
  [/brave/i, siBrave],
  [/opera/i, siOpera],
  [/\.net/i, siDotnet],
  [/^go\b/i, siGo],
  [/rust/i, siRust],
  [/^bun\b/i, siBun],
  [/pnpm/i, siPnpm],
  [/\bnpm\b/i, siNpm],
  [/^uv\b|uv tool/i, siUv],
  [/cursor/i, siCursor],
  [/gemini|antigravity/i, siGooglegemini],
  [/postgres/i, siPostgresql],
  [/nvidia|cuda/i, siNvidia],
  [/grammarly/i, siGrammarly],
  [/windsurf|codeium/i, siWindsurf],
  [/lm ?studio/i, siLmstudio],
  [/perplexity/i, siPerplexity],
  [/vercel|next\.js devtools/i, siVercel],
  [/railway/i, siRailway],
  [/warp/i, siWarp],
  [/\bwsl\b|ubuntu/i, siUbuntu],
  [/linux/i, siLinux],
  [/cline|kilo/i, siCline],
  [/deepseek/i, siDeepseek],
  [/qwen/i, siQwen],
  [/kimi|moonshot/i, siKimi],
  [/zcode|\bglm\b|z\.ai|zhipu/i, siZdotai],
  [/puppeteer/i, siPuppeteer],
  [/mistral/i, siMistralai],
  [/java|jdk/i, siOpenjdk],
  [/replicate/i, siReplicate],
  [/deno/i, siDeno],
  [/tauri/i, siTauri],
  [/stitch|google/i, siGoogle],
  [/anthropic/i, siAnthropic]
];

/** The brand mark for a tool, matched on its name first, then its category. */
export function brandFor(name: string, category = ''): Brand | null {
  return BRANDS.find(([re]) => re.test(name))?.[1] ?? BRANDS.find(([re]) => re.test(category))?.[1] ?? null;
}

/** Brand colour, or near-white when the brand is black/dark and would vanish on the dark UI. */
export function markColor(hex: string): string {
  const n = parseInt(hex, 16);
  const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.3 ? '#e8eaed' : `#${hex}`;
}

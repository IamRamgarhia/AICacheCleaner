/**
 * Maps a tool/category name to its identity colour.
 *
 * Identity colour answers "which tool is this?" — a different question from the
 * safety tier, which answers "is this safe to delete?". Keeping the two on
 * separate visual channels (quiet hue marker vs saturated chip + word) is what
 * lets the app use colour generously without diluting the safety signal.
 */
const TOOL_HUES: { match: RegExp; token: string }[] = [
  { match: /claude|anthropic/i, token: '--ins-tool-claude' },
  { match: /antigravity|gemini/i, token: '--ins-tool-antigravity' },
  { match: /cursor/i, token: '--ins-tool-cursor' },
  { match: /ollama|lm studio|jan\b/i, token: '--ins-tool-ollama' },
  { match: /glm|zhipu|codegeex/i, token: '--ins-tool-glm' },
  { match: /kimi|moonshot/i, token: '--ins-tool-kimi' },
  { match: /codex/i, token: '--ins-tool-codex' },
  { match: /openai|copilot/i, token: '--ins-tool-openai' },
  { match: /hugging\s?face|pytorch|torch/i, token: '--ins-tool-huggingface' },
  { match: /vs ?code|mcp/i, token: '--ins-tool-vscode' }
];

export function toolColor(name: string | undefined): string {
  if (!name) return 'var(--ins-tool-other)';
  const hit = TOOL_HUES.find(h => h.match.test(name));
  return `var(${hit ? hit.token : '--ins-tool-other'})`;
}

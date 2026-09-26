// Tolerant readers for the two config formats MCP clients use: JSON with
// comments / trailing commas (VS Code, Cursor, Gemini …) and Codex's TOML.
// No new dependency: only the subset these files actually use.

/** Parse JSON that may contain comments, trailing commas and a BOM. Throws on invalid input. */
export function parseJsonc(text: string): unknown {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
    } else {
      if (c === '}' || c === ']') {
        // Drop a trailing comma before the closing bracket.
        let k = out.length - 1;
        while (k >= 0 && /\s/.test(out[k])) k--;
        if (out[k] === ',') out = out.slice(0, k) + out.slice(k + 1);
      }
      out += c;
      i++;
    }
  }
  return JSON.parse(out);
}

const STRINGS = /"(?:[^"\\]|\\.)*"|'[^']*'/g;

function unquote(raw: string): string {
  if (raw.startsWith("'")) return raw.slice(1, -1);
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw) as string; } catch { return raw.slice(1, -1); }
  }
  return raw;
}

/** Split a dotted TOML key (`mcp_servers."my server".env`) into parts. */
function splitKey(key: string): string[] {
  return [...key.matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'|[^.\s]+/g)].map(m => unquote(m[0]));
}

function arrayClosed(value: string): boolean {
  const bare = value.replace(STRINGS, '').replace(/#.*$/gm, '');
  return (bare.match(/\[/g)?.length ?? 0) <= (bare.match(/]/g)?.length ?? 0);
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v.startsWith('"') || v.startsWith("'")) return unquote(v.match(STRINGS)?.[0] ?? v);
  if (v.startsWith('[')) {
    // Drop comments outside strings, then keep the string elements.
    const noComments = v.replace(/("(?:[^"\\]|\\.)*"|'[^']*')|#.*$/gm, (_m, str: string | undefined) => str ?? '');
    return [...noComments.matchAll(STRINGS)].map(m => unquote(m[0]));
  }
  if (v.startsWith('{')) {
    // Inline table: only the key names are kept (it is only used for env).
    const bare = v.replace(STRINGS, '""');
    return Object.fromEntries([...bare.matchAll(/([A-Za-z0-9_-]+)\s*=/g)].map(m => [m[1], true]));
  }
  const word = v.split(/[\s#]/)[0];
  if (word === 'true' || word === 'false') return word === 'true';
  const n = Number(word);
  return Number.isFinite(n) ? n : word;
}

const KEY = /^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)(?:\s*\.\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=\s*(.*)$/;

/**
 * The `[mcp_servers.<name>]` tables of a Codex config.toml. Env tables
 * (`[mcp_servers.<name>.env]`, `env = { … }`, `env.KEY = …`) keep key names only.
 */
export function parseCodexMcpToml(text: string): Record<string, Record<string, unknown>> {
  // Null prototype: a server named "__proto__" must not reach Object.prototype.
  const servers: Record<string, Record<string, unknown>> = Object.create(null);
  let target: { name: string; envOnly: boolean } | null = null;
  const lines = text.split(/\r?\n/);
  const addEnv = (name: string, key: string) => {
    servers[name].env = { ...(servers[name].env as Record<string, true> | undefined), [key]: true };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[')) {
      const header = line.match(/^\[\s*([^\][]+?)\s*\]\s*(?:#.*)?$/);
      const parts = header ? splitKey(header[1]) : [];
      const isServer = parts[0] === 'mcp_servers' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'env'));
      target = isServer ? { name: parts[1], envOnly: parts.length === 3 } : null;
      if (target) servers[target.name] ??= {};
      continue;
    }
    if (!target) continue;

    const kv = line.match(KEY);
    if (!kv) continue;
    let value = kv[2];
    while (value.trimStart().startsWith('[') && !arrayClosed(value) && i + 1 < lines.length) value += `\n${lines[++i]}`;

    const key = splitKey(kv[1]);
    if (target.envOnly) addEnv(target.name, key.join('.'));
    else if (key[0] === 'env' && key.length > 1) addEnv(target.name, key.slice(1).join('.'));
    else if (key[0] === 'env') {
      const table = parseValue(value);
      if (table && typeof table === 'object' && !Array.isArray(table)) servers[target.name].env = { ...(servers[target.name].env as object), ...table };
    } else if (key.length === 1) servers[target.name][key[0]] = parseValue(value);
  }
  return servers;
}

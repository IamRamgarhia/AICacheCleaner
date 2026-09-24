// Read-only inventory of MCP servers defined across AI clients, with live
// RAM/CPU for the ones running now. Secrets never leave this module: env and
// header values are not read out, args/URLs are redacted, and process command
// lines are only compared against, never returned.

import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AIProcessItem } from '../src/types';
import type { McpConfigFile, McpDefinition, McpInventory, McpServer, McpTransport } from '../src/lib/types/mcp';
import { parseCodexMcpToml, parseJsonc } from './mcpConfigParse';
import { redactArgs, redactText } from './mcpRedact';
import { stableId } from './ids';

export interface McpLocations {
  home: string;
  /** %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on Linux. */
  appData: string;
}

export function defaultMcpLocations(): McpLocations {
  const home = os.homedir();
  const appData = process.platform === 'win32'
    ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return { home, appData };
}

type Kind = 'json' | 'vscode-settings' | 'claude-code' | 'claude-plugins' | 'codex';
interface Source { client: string; file: string; kind: Kind }

function sources({ home, appData }: McpLocations): Source[] {
  const extensions = (editor: string): Source[] => [
    ['Cline', 'saoudrizwan.claude-dev', 'cline_mcp_settings.json'],
    ['Roo Code', 'rooveterinaryinc.roo-cline', 'mcp_settings.json'],
    ['Kilo Code', 'kilocode.kilo-code', 'mcp_settings.json']
  ].map(([client, id, file]) => ({
    client: `${client} (${editor === 'Code' ? 'VS Code' : editor})`,
    file: path.join(appData, editor, 'User', 'globalStorage', id, 'settings', file),
    kind: 'json'
  }));
  return [
    { client: 'Claude Desktop', file: path.join(appData, 'Claude', 'claude_desktop_config.json'), kind: 'json' },
    { client: 'Claude Code', file: path.join(home, '.claude.json'), kind: 'claude-code' },
    { client: 'Claude Code', file: path.join(home, '.claude', 'settings.json'), kind: 'json' },
    { client: 'Claude Code plugin', file: path.join(home, '.claude', 'plugins', 'installed_plugins.json'), kind: 'claude-plugins' },
    { client: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), kind: 'json' },
    { client: 'VS Code', file: path.join(appData, 'Code', 'User', 'mcp.json'), kind: 'json' },
    { client: 'VS Code', file: path.join(appData, 'Code', 'User', 'settings.json'), kind: 'vscode-settings' },
    { client: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), kind: 'json' },
    { client: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json'), kind: 'json' },
    { client: 'Antigravity', file: path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), kind: 'json' },
    { client: 'Codex', file: path.join(home, '.codex', 'config.toml'), kind: 'codex' },
    ...['Code', 'Cursor', 'Antigravity'].flatMap(extensions)
  ];
}

interface RawDef { name: string; entry: unknown; client: string; configPath: string; scope: string; disabled: boolean }
interface ReadResult { configs: McpConfigFile[]; defs: RawDef[] }
type Loaded = { data: unknown } | { error: string } | null;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const objOf = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});

/** Parsed file, null when missing. `error` is generic on purpose: parser messages quote file content. */
async function load(file: string, kind: Kind): Promise<Loaded> {
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : { error: 'Could not read the file' };
  }
  try {
    return { data: kind === 'codex' ? parseCodexMcpToml(text) : parseJsonc(text) };
  } catch {
    return { error: kind === 'codex' ? 'Not valid TOML' : 'Not valid JSON' };
  }
}

function defsFrom(map: unknown, base: Omit<RawDef, 'name' | 'entry' | 'disabled'>, disabledNames: unknown = []): RawDef[] {
  const off = new Set(Array.isArray(disabledNames) ? disabledNames : []);
  return Object.entries(objOf(map)).map(([name, entry]) => ({ ...base, name, entry, disabled: off.has(name) }));
}

/** Installed Claude Code plugins that ship a .mcp.json (from installed_plugins.json). */
async function readPlugins(src: Source, data: unknown, home: string): Promise<ReadResult> {
  const settings = await load(path.join(home, '.claude', 'settings.json'), 'json');
  const enabled = objOf(settings && 'data' in settings ? objOf(settings.data).enabledPlugins : undefined);
  const result: ReadResult = { configs: [], defs: [] };
  const seen = new Set<string>();
  for (const [key, installs] of Object.entries(objOf(objOf(data).plugins))) {
    for (const install of Array.isArray(installs) ? installs : []) {
      const dir = objOf(install).installPath;
      if (typeof dir !== 'string' || !path.isAbsolute(dir) || seen.has(dir)) continue;
      seen.add(dir);
      const file = path.join(dir, '.mcp.json');
      const res = await load(file, 'json');
      if (!res) continue;
      const client = `${src.client}: ${key.split('@')[0]}`;
      if ('error' in res) {
        result.configs.push({ client, path: file, status: 'unreadable', serverCount: 0, error: res.error });
        continue;
      }
      // Plugin .mcp.json is either { mcpServers: {...} } or the bare map.
      const map = isObj(objOf(res.data).mcpServers) ? objOf(res.data).mcpServers : res.data;
      const projectPath = objOf(install).projectPath;
      const scope = objOf(install).scope === 'project' && typeof projectPath === 'string' ? projectPath : 'global';
      const found = defsFrom(map, { client, configPath: file, scope }).map(d => ({ ...d, disabled: enabled[key] === false }));
      result.configs.push({ client, path: file, status: 'ok', serverCount: found.length });
      result.defs.push(...found);
    }
  }
  return result;
}

async function readSource(src: Source, loc: McpLocations): Promise<ReadResult> {
  const res = await load(src.file, src.kind);
  if (!res) return { configs: [], defs: [] };
  if ('error' in res) {
    return { configs: [{ client: src.client, path: src.file, status: 'unreadable', serverCount: 0, error: res.error }], defs: [] };
  }
  const data = objOf(res.data);
  const base = { client: src.client, configPath: src.file, scope: 'global' };

  // installed_plugins.json itself defines nothing; only the .mcp.json files are listed.
  if (src.kind === 'claude-plugins') return readPlugins(src, data, loc.home);

  let defs: RawDef[];
  if (src.kind === 'claude-code') {
    defs = defsFrom(data.mcpServers, base);
    for (const [project, cfg] of Object.entries(objOf(data.projects))) {
      defs.push(...defsFrom(objOf(cfg).mcpServers, { ...base, scope: project }, objOf(cfg).disabledMcpServers));
    }
  } else if (src.kind === 'vscode-settings') {
    defs = defsFrom(objOf(data.mcp).servers ?? data['mcp.servers'], base);
  } else if (src.kind === 'codex') {
    defs = defsFrom(data, base);
  } else {
    defs = defsFrom(data.mcpServers ?? data.servers, base);
  }
  return { configs: [{ client: src.client, path: src.file, status: 'ok', serverCount: defs.length }], defs };
}

// Launchers, interpreters and their subcommands: never distinctive enough to
// identify one server in a process list.
const RUNNERS = /^(npx|npm|pnpm|pnpx|yarn|bunx|bun|node|deno|uv|uvx|python[\d.]*|py|pipx|docker|podman|cmd|powershell|pwsh|sh|bash|dotnet|java|run|exec|dlx|tool|start)$/i;

const norm = (s: string) => s.toLowerCase().replace(/\\/g, '/').replace(/["']/g, '');

/**
 * The arg (package name or script path) that identifies this server in a
 * process command line. Args that look secret are never used as match keys.
 */
export function matchToken(command: string | undefined, args: string[]): string | undefined {
  for (const arg of args) {
    if (arg.startsWith('-') || /^\/\w$/.test(arg) || arg.includes('${') || /%\w+%/.test(arg)) continue;
    if (redactText(arg) !== arg) continue;
    const token = norm(arg).replace(/(.)@(latest|next|[\d^~][\w.-]*)$/, '$1');
    if (token.length >= 4 && !RUNNERS.test(token)) return token;
  }
  const base = command ? path.posix.basename(norm(command)).replace(/\.(exe|cmd|bat)$/, '') : '';
  return base.length >= 4 && !RUNNERS.test(base) && redactText(base) === base ? base : undefined;
}

interface Normalized {
  transport: McpTransport; command?: string; args: string[]; url?: string; envNames: string[]; token?: string; disabled: boolean;
}

function normalize(def: RawDef): Normalized | null {
  const e = objOf(def.entry);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const command = str(e.command);
  const url = str(e.httpUrl) ?? str(e.url) ?? str(e.serverUrl);
  const type = String(e.type ?? e.transportType ?? '').toLowerCase();
  // Gemini CLI: `url` is SSE, `httpUrl` is streamable HTTP.
  const sse = type.includes('sse') || (def.client === 'Gemini CLI' && !e.httpUrl && !!e.url);
  const transport: McpTransport | null = command && !url ? 'stdio' : url ? (sse ? 'sse' : 'http') : null;
  if (!transport) return null;
  const rawArgs = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string') : [];
  const envNames = [
    ...Object.keys(objOf(e.env)),
    ...(Array.isArray(e.env_vars) ? e.env_vars.filter((v): v is string => typeof v === 'string') : []),
    ...(str(e.bearer_token_env_var) ? [e.bearer_token_env_var as string] : [])
  ];
  const stdio = transport === 'stdio';
  return {
    transport,
    command: stdio && command ? redactText(command) : undefined,
    args: stdio ? redactArgs(rawArgs) : [],
    url: url ? redactText(url) : undefined,
    envNames: [...new Set(envNames)].sort(),
    token: stdio ? matchToken(command, rawArgs) : undefined,
    disabled: def.disabled || e.disabled === true || e.enabled === false
  };
}

interface Row { server: McpServer; token?: string }

/** Sum RAM/CPU of processes whose command line contains a server's token; the longest token wins. */
function attachRunning(rows: Row[], processes: AIProcessItem[]): Row[] {
  const usage = new Map<Row, AIProcessItem[]>();
  for (const proc of processes) {
    const cmd = norm(proc.command || '');
    let best = 0;
    let owners: Row[] = [];
    for (const row of rows) {
      if (!row.token || row.token.length < best || !cmd.includes(row.token)) continue;
      if (row.token.length > best) { best = row.token.length; owners = []; }
      owners.push(row);
    }
    for (const row of owners) usage.set(row, [...(usage.get(row) ?? []), proc]);
  }
  return rows.map(row => {
    const procs = usage.get(row);
    if (!procs) return row;
    const running = {
      processCount: procs.length,
      memoryMb: procs.reduce((a, p) => a + p.memoryMb, 0),
      cpuPercent: Math.round(procs.reduce((a, p) => a + p.cpuPercent, 0) * 10) / 10,
      pids: procs.map(p => p.pid)
    };
    return { ...row, server: { ...row.server, running } };
  });
}

export async function listMcpServers(processes: AIProcessItem[], loc: McpLocations = defaultMcpLocations()): Promise<McpInventory> {
  const reads = await Promise.all(sources(loc).map(src => readSource(src, loc)));
  const rows = new Map<string, Row>();

  for (const def of reads.flatMap(r => r.defs)) {
    const n = normalize(def);
    if (!n) continue;
    const signature = n.transport === 'stdio' ? n.token ?? [n.command, ...n.args].join(' ') : (n.url ?? '').split(/[?#]/)[0];
    const key = `${def.name.toLowerCase()}|${n.transport}|${signature.toLowerCase()}`;
    const definition: McpDefinition = { client: def.client, configPath: def.configPath, scope: def.scope, disabled: n.disabled };
    const prev = rows.get(key)?.server;
    const server: McpServer = prev
      ? {
          ...prev,
          definitions: [...prev.definitions, definition],
          clients: prev.clients.includes(def.client) ? prev.clients : [...prev.clients, def.client],
          envNames: [...new Set([...prev.envNames, ...n.envNames])].sort(),
          disabled: prev.disabled && n.disabled
        }
      : {
          id: stableId('mcp', key), name: def.name, transport: n.transport, command: n.command, args: n.args, url: n.url,
          envNames: n.envNames, clients: [def.client], definitions: [definition], disabled: n.disabled, running: null
        };
    rows.set(key, { server, token: rows.get(key)?.token ?? n.token });
  }

  const servers = attachRunning([...rows.values()], processes)
    .map(r => r.server)
    .sort((a, b) => (b.running?.memoryMb ?? -1) - (a.running?.memoryMb ?? -1) || a.name.localeCompare(b.name));
  return { servers, configs: reads.flatMap(r => r.configs) };
}

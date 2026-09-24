// Tests for the MCP server inventory and the storage growth history.
//
// MCP configs hold API keys, so the redaction tests matter as much as the
// parsing ones: nothing secret may reach the UI. All client configs are
// fixtures under the OS temp dir passed in explicitly; the real home is
// never read.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bundle } from './bundle-helper.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Fake credentials in real formats, assembled at runtime so secret scanners
// (and GitHub push protection) never see a key-shaped literal in the source.
const FAKE_GH = ['ghp', '16C7e42F292c6912E7710c838347Ae178B4a'].join('_');
const FAKE_GOOGLE = ['AIza', 'SyD-abcdefghijklmnopqrstuvwxyz12345'].join('');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-insights-'));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-insights-fx-'));
let lib;

before(() => {
  const entry = path.join(repoRoot, 'server', '__insights_probe.generated.ts');
  const outfile = path.join(outDir, 'insights.cjs');
  fs.writeFileSync(
    entry,
    `export { listMcpServers, matchToken } from './mcpServers';\n` +
      `export { redactArgs, redactText, redactUrl, REDACTED } from './mcpRedact';\n` +
      `export { parseJsonc, parseCodexMcpToml } from './mcpConfigParse';\n` +
      `export { recordScan, getGrowth, addPoint, computeGrowth, pointFromItems, RETENTION_DAYS } from './growthHistory';\n` +
      `export { shouldAlertGrowth } from '../src/lib/useGrowthAlert';\n`,
    'utf-8'
  );
  try {
    bundle(entry, outfile);
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
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};

// --- Parsers ---

test('JSONC: comments, trailing commas and BOM are tolerated; strings are untouched', () => {
  const text = '\uFEFF{\n // line comment\n "a": "http://x/*not a comment*/", /* block */\n "b": [1, 2,],\n "c": "x,]", \n}';
  assert.deepEqual(lib.parseJsonc(text), { a: 'http://x/*not a comment*/', b: [1, 2], c: 'x,]' });
  assert.deepEqual(lib.parseJsonc('{"q": "say \\"hi\\" // no"}'), { q: 'say "hi" // no' });
  assert.throws(() => lib.parseJsonc('{ nope'));
});

test('Codex TOML: only mcp_servers tables, env keys only, multi-line arrays, quoted names', () => {
  const toml = [
    'model = "gpt-5"',
    '[mcp_servers.fs]',
    'command = "npx" # trailing comment',
    'args = [',
    '  "-y",',
    '  "@modelcontextprotocol/server-filesystem", # inline',
    "  'C:\\data',",
    ']',
    'env = { API_KEY = "sk-abcdefghijklmnop", MODE = "a=b" }',
    'env.EXTRA_TOKEN = "zzz"',
    '[mcp_servers.fs.env]',
    'OTHER_SECRET = "hidden"',
    '[mcp_servers."my server"]',
    'url = "https://example.com/mcp"',
    'enabled = false',
    'bearer_token_env_var = "MY_TOKEN"',
    '[profiles.x]',
    'command = "ignored"',
    '[mcp_servers.win]',
    'command = "C:\\\\tools\\\\srv.exe"'
  ].join('\n');
  const s = lib.parseCodexMcpToml(toml);
  assert.deepEqual(Object.keys(s).sort(), ['fs', 'my server', 'win']);
  assert.equal(s.fs.command, 'npx');
  assert.deepEqual(s.fs.args, ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\data']);
  assert.deepEqual(Object.keys(s.fs.env).sort(), ['API_KEY', 'EXTRA_TOKEN', 'MODE', 'OTHER_SECRET']);
  assert.ok(!JSON.stringify(s).includes('sk-abcdefghijklmnop'), 'env values are never kept');
  assert.ok(!JSON.stringify(s).includes('hidden'));
  assert.equal(s['my server'].enabled, false);
  assert.equal(s['my server'].url, 'https://example.com/mcp');
  assert.equal(s.win.command, 'C:\\tools\\srv.exe');

  lib.parseCodexMcpToml('[mcp_servers.__proto__]\ncommand = "x"\n[mcp_servers.__proto__.env]\nPOLLUTED = "1"');
  assert.equal({}.command, undefined, 'a hostile server name cannot pollute Object.prototype');
  assert.equal({}.env, undefined);
});

// --- Redaction ---

test('redaction: known token formats', () => {
  const R = '[redacted]';
  const cases = {
    'sk-ant-api03-abcdefghijklmnop': R,
    'sk-proj-AbCdEf123456': R,
    [FAKE_GH]: R,
    'gho_abcdefghijklmnop': R,
    'github_pat_11ABCDEFG0123456789_abcdefghijk': R,
    'xoxb-123456789012-abcdefghij': R,
    'xoxp-123456789012-abcdefghij': R,
    [FAKE_GOOGLE]: R,
    'Bearer abc.def-ghi': `Bearer ${R}`,
    'Authorization: Bearer abc': `Authorization: ${R}`,
    'X-Api-Key: 12345': `X-Api-Key: ${R}`,
    '--token=abc': `--token=${R}`,
    '--api-key=abc': `--api-key=${R}`,
    'API_KEY=abc': `API_KEY=${R}`,
    'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x': `GITHUB_PERSONAL_ACCESS_TOKEN=${R}`,
    '0123456789abcdef0123456789abcdef': R,
    'AbC123xyzQWERTY987654321zz': R,
    'aB3dE5gH7jK9mN1pQ3sT5vX7/zA2cE4gI6kM8oQ0sU2w/yA4cE6gI8': R,
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig_nature': R,
    '550e8400-e29b-41d4-a716-446655440000': R,
    'prefix-sk-live-1234567890': `prefix-${R}`
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(lib.redactText(input), expected, input);
});

test('redaction: URLs lose credentials and secret params only', () => {
  const R = '[redacted]';
  assert.equal(lib.redactUrl('https://user:pass@host.com/x'), `https://${R}@host.com/x`);
  assert.equal(lib.redactUrl('https://api.x.com/v1?key=abc&mode=fast&token=t'), `https://api.x.com/v1?key=${R}&mode=fast&token=${R}`);
  assert.equal(lib.redactUrl('https://x/?client_secret=abc&password=p&api_key=k'), `https://x/?client_secret=${R}&password=${R}&api_key=${R}`);
  assert.equal(lib.redactUrl('https://x/cb#access_token=abc'), `https://x/cb#access_token=${R}`);
  assert.equal(lib.redactUrl('https://mcp.context7.com/mcp?client=claude-code-plugin'), 'https://mcp.context7.com/mcp?client=claude-code-plugin');
  assert.equal(lib.redactText('--url=https://u:p@h/x'), `--url=https://${R}@h/x`);
  assert.equal(lib.redactText('see https://h/x?token=abc now'), `see https://h/x?token=${R} now`);
});

test('redaction: values after secret flags, not after ordinary ones', () => {
  const R = '[redacted]';
  assert.deepEqual(
    lib.redactArgs(['--api-key', 'plain', '--token', 't', '--password', 'hunter2', '--key', 'k', '--secret', 's', '--client-secret', 'c']),
    ['--api-key', R, '--token', R, '--password', R, '--key', R, '--secret', R, '--client-secret', R]
  );
  assert.deepEqual(lib.redactArgs(['--token', '--verbose']), ['--token', '--verbose'], 'a following flag is not a value');
  assert.deepEqual(lib.redactArgs(['-e', 'GITHUB_TOKEN', '-e', 'GH_TOKEN=abc']), ['-e', 'GITHUB_TOKEN', '-e', `GH_TOKEN=${R}`]);
  assert.deepEqual(lib.redactArgs(['--port', '8080', '--root', 'D:\\data']), ['--port', '8080', '--root', 'D:\\data']);
});

test('redaction: package names, paths and versions survive', () => {
  for (const safe of [
    '@modelcontextprotocol/server-filesystem',
    '@playwright/mcp@latest',
    'task-master-ai',
    'mcp-server-fetch',
    'server-filesystem-v2-beta-12345678',
    '-y',
    '--headless',
    'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\x\\index.js',
    '/home/me/projects/abcdef0123456789abcdef0123456789abcdef01/server.js',
    'https://mcp.context7.com/mcp'
  ]) assert.equal(lib.redactText(safe), safe, safe);
});

test('match tokens skip launchers, flags, placeholders and secrets', () => {
  assert.equal(lib.matchToken('npx', ['-y', '@playwright/mcp@latest']), '@playwright/mcp');
  assert.equal(lib.matchToken('uvx', ['mcp-server-fetch']), 'mcp-server-fetch');
  assert.equal(lib.matchToken('python', ['-m', 'mcp_server_time']), 'mcp_server_time');
  assert.equal(lib.matchToken('node', ['C:\\srv\\Memory\\index.js']), 'c:/srv/memory/index.js');
  assert.equal(lib.matchToken('C:\\tools\\memorybridge.exe', []), 'memorybridge');
  assert.equal(lib.matchToken('npx', ['-y']), undefined);
  assert.equal(lib.matchToken('node', ['${CLAUDE_PLUGIN_ROOT}/x.js', 'sk-abcdefghijklmnop']), undefined);
});

// --- Inventory ---

const GH = FAKE_GH;
const SECRETS = [GH, 'sk-live-1234567890abcdef', 'BSAabcdefghij1234567890XYZ', 'SUPERSECRETQUERY', 'hunter2pass', 'Bearer abc123', 'LEAKME'];

function buildFixtureHome() {
  const home = path.join(fixtures, 'home');
  const appData = path.join(fixtures, 'appdata');
  const pluginDir = path.join(fixtures, 'plugins', 'pw', 'v1');
  const ctxDir = path.join(fixtures, 'plugins', 'ctx', 'v1');
  const fsServer = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\'], env: { GITHUB_TOKEN: GH } };

  write(path.join(appData, 'Claude', 'claude_desktop_config.json'), { mcpServers: { filesystem: fsServer } });
  write(path.join(home, '.claude.json'), {
    mcpServers: { memorybridge: { command: 'C:\\tools\\memorybridge.exe' } },
    projects: {
      'D:\\proj': { mcpServers: { filesystem: fsServer, 'proj-only': { command: 'node', args: ['D:\\proj\\srv.js'] } }, disabledMcpServers: ['proj-only'] }
    }
  });
  write(path.join(home, '.claude', 'settings.json'), { enabledPlugins: { 'ctx@market': false, 'pw@market': true } });
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'pw@market': [{ scope: 'user', installPath: pluginDir }],
      'ctx@market': [{ scope: 'user', installPath: ctxDir }],
      'gone@market': [{ scope: 'user', installPath: path.join(fixtures, 'plugins', 'missing') }]
    }
  });
  write(path.join(pluginDir, '.mcp.json'), { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } });
  write(path.join(ctxDir, '.mcp.json'), {
    mcpServers: { context7: { type: 'http', url: 'https://mcp.context7.com/mcp?api_key=SUPERSECRETQUERY', headers: { Authorization: 'Bearer abc123' } } }
  });
  write(path.join(home, '.cursor', 'mcp.json'), { mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } } });
  write(path.join(appData, 'Code', 'User', 'mcp.json'), '{\n  // VS Code allows comments\n  "servers": { "github": { "type": "http", "url": "https://me:hunter2pass@api.githubcopilot.com/mcp/", }, },\n}');
  write(path.join(appData, 'Code', 'User', 'settings.json'), '{ "editor.fontSize": 13, /* x */ "mcp": { "servers": { "fetch": { "command": "uvx", "args": ["mcp-server-fetch"], }, }, }, }');
  write(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), {
    mcpServers: { brave: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: 'BSAabcdefghij1234567890XYZ' }, disabled: true } }
  });
  write(path.join(home, '.gemini', 'settings.json'), { mcpServers: { events: { url: 'http://localhost:9000/sse' }, remote: { httpUrl: 'https://x.example/mcp' } } });
  write(path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), '{ "mcpServers": { "LEAKME": ');
  write(path.join(home, '.codex', 'config.toml'), [
    '[mcp_servers.filesystem]', 'command = "npx"', 'args = ["-y", "@modelcontextprotocol/server-filesystem", "D:\\\\"]',
    '[mcp_servers.filesystem.env]', `GITHUB_TOKEN = "${GH}"`,
    '[mcp_servers.off]', 'command = "uvx"', 'args = ["mcp-server-off"]', 'enabled = false'
  ].join('\n'));
  write(path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), {
    mcpServers: { memory: { command: 'node', args: ['C:\\srv\\memory\\index.js', '--api-key', 'sk-live-1234567890abcdef'] } }
  });
  write(path.join(appData, 'Antigravity', 'User', 'globalStorage', 'kilocode.kilo-code', 'settings', 'mcp_settings.json'), {
    mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } }
  });
  return { home, appData };
}

const proc = (pid, command, memoryMb, cpuPercent = 0) =>
  ({ pid, ppid: 1, name: 'node.exe', tool: 'x', cpuPercent, memoryMb, formattedMemory: `${memoryMb} MB`, isZombie: false, command });

const PROCESSES = [
  proc(10, 'node C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js D:\\', 50, 1.5),
  proc(11, '"C:\\Program Files\\nodejs\\node.exe" npx-cli.js -y @modelcontextprotocol/server-filesystem', 30, 0.5),
  proc(12, 'node C:\\srv\\memory\\index.js --api-key sk-live-1234567890abcdef', 70, 2),
  proc(13, 'C:\\tools\\memorybridge.exe serve', 20),
  proc(14, 'node unrelated-thing.js', 999)
];

test('inventory reads every client format, dedupes, marks disabled and running', async () => {
  const inv = await lib.listMcpServers(PROCESSES, buildFixtureHome());
  const byName = Object.fromEntries(inv.servers.map(s => [s.name, s]));

  assert.deepEqual(Object.keys(byName).sort(), [
    'brave', 'context7', 'events', 'fetch', 'filesystem', 'github', 'memory', 'memorybridge', 'off', 'playwright', 'proj-only', 'remote'
  ]);

  const fsRow = byName.filesystem;
  assert.deepEqual(fsRow.clients.sort(), ['Claude Code', 'Claude Desktop', 'Codex']);
  assert.equal(fsRow.definitions.length, 3);
  assert.ok(fsRow.definitions.some(d => d.scope === 'D:\\proj'));
  assert.ok(fsRow.definitions.some(d => d.scope === 'global'));
  assert.deepEqual(fsRow.envNames, ['GITHUB_TOKEN']);
  assert.equal(fsRow.transport, 'stdio');
  assert.equal(fsRow.command, 'npx');
  assert.deepEqual(fsRow.running, { processCount: 2, memoryMb: 80, cpuPercent: 2, pids: [10, 11] });

  assert.deepEqual(byName.playwright.clients.sort(), ['Claude Code plugin: pw', 'Cursor']);
  assert.equal(byName.playwright.running, null);
  assert.deepEqual(byName.fetch.clients.sort(), ['Kilo Code (Antigravity)', 'VS Code']);

  assert.equal(byName.memory.running.processCount, 1);
  assert.equal(byName.memory.running.memoryMb, 70);
  assert.deepEqual(byName.memory.args, ['C:\\srv\\memory\\index.js', '--api-key', '[redacted]']);
  assert.equal(byName.memorybridge.running.pids[0], 13);

  assert.equal(byName.brave.disabled, true);
  assert.deepEqual(byName.brave.envNames, ['BRAVE_API_KEY']);
  assert.equal(byName.off.disabled, true);
  assert.equal(byName['proj-only'].disabled, true);
  assert.equal(byName.context7.disabled, true, 'plugin turned off in enabledPlugins');
  assert.equal(byName.filesystem.disabled, false);

  assert.equal(byName.context7.transport, 'http');
  assert.equal(byName.context7.url, 'https://mcp.context7.com/mcp?api_key=[redacted]');
  assert.equal(byName.github.url, 'https://[redacted]@api.githubcopilot.com/mcp/');
  assert.equal(byName.events.transport, 'sse');
  assert.equal(byName.remote.transport, 'http');

  // Servers that are running sort first, largest first.
  assert.equal(inv.servers[0].name, 'filesystem');

  const bad = inv.configs.find(c => c.client === 'Antigravity');
  assert.equal(bad.status, 'unreadable');
  assert.equal(bad.error, 'Not valid JSON');
  assert.ok(inv.configs.filter(c => c.status === 'ok').length >= 11);
  assert.ok(!inv.configs.some(c => c.path.includes('missing')), 'missing plugin config is skipped, not reported');
});

test('inventory never returns secrets, env values, headers or process command lines', async () => {
  const inv = await lib.listMcpServers(PROCESSES, buildFixtureHome());
  const json = JSON.stringify(inv);
  for (const secret of SECRETS) assert.ok(!json.includes(secret), `leaked ${secret}`);
  for (const raw of ['npx-cli.js', 'unrelated-thing', 'exe serve', 'headers', 'Authorization']) assert.ok(!json.includes(raw), `leaked ${raw}`);
  for (const s of inv.servers) assert.ok(!('env' in s) && !('headers' in s));
});

test('inventory with no configs is empty, not an error', async () => {
  const empty = path.join(fixtures, 'empty-home');
  fs.mkdirSync(empty, { recursive: true });
  assert.deepEqual(await lib.listMcpServers([], { home: empty, appData: empty }), { servers: [], configs: [] });
});

// --- Growth ---

const item = (category, p, sizeBytes) => ({ id: p, name: p, category, path: path.join(fixtures, p), sizeBytes });
const day = s => new Date(`${s}T12:00:00`);

test('growth: per-tool totals count nested items once', () => {
  const pt = lib.pointFromItems([item('Claude', 'a', 100), item('Claude', path.join('a', 'b'), 40), item('Cursor', 'c', 50)], '2026-01-01');
  assert.deepEqual(pt, { date: '2026-01-01', totalBytes: 150, perTool: { Claude: 100, Cursor: 50 } });
});

test('growth: one point per day, latest wins; corrupt file restarts; no tmp left behind', async () => {
  const file = path.join(fixtures, 'growth', 'growth-history.json');
  write(file, '{corrupt');
  await lib.recordScan([item('Claude', 'a', 100)], { file, now: day('2026-03-01') });
  await lib.recordScan([item('Claude', 'a', 300)], { file, now: day('2026-03-01') });
  await lib.recordScan([item('Claude', 'a', 400)], { file, now: day('2026-03-02') });
  await lib.recordScan([], { file, now: day('2026-03-03') });
  const report = await lib.getGrowth({ file });
  assert.deepEqual(report.points.map(p => [p.date, p.totalBytes]), [['2026-03-01', 300], ['2026-03-02', 400]]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['growth-history.json']);
});

test('growth: concurrent records do not lose a day', async () => {
  const file = path.join(fixtures, 'growth-concurrent', 'h.json');
  await Promise.all([
    lib.recordScan([item('A', 'a', 1)], { file, now: day('2026-04-01') }),
    lib.recordScan([item('A', 'a', 2)], { file, now: day('2026-04-02') }),
    lib.recordScan([item('A', 'a', 3)], { file, now: day('2026-04-03') })
  ]);
  assert.equal((await lib.getGrowth({ file })).points.length, 3);
});

test('growth: retention keeps the last 120 days', () => {
  let points = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 130; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    points = lib.addPoint(points, { date, totalBytes: i, perTool: {} });
  }
  assert.equal(lib.RETENTION_DAYS, 120);
  assert.equal(points.length, 120);
  assert.equal(points[0].totalBytes, 10);
  assert.equal(points.at(-1).totalBytes, 129);
});

test('growth: 7 and 30 day changes, sorted by fastest growth', () => {
  const points = [
    { date: '2026-01-01', totalBytes: 150, perTool: { Claude: 100, Cursor: 50 } },
    { date: '2026-01-24', totalBytes: 250, perTool: { Claude: 200, Cursor: 50 } },
    { date: '2026-01-31', totalBytes: 310, perTool: { Claude: 260, Cursor: 40, Ollama: 10 } }
  ];
  const r = lib.computeGrowth(points);
  assert.equal(r.spanDays, 30);
  assert.equal(r.totalChange7d, 60);
  assert.equal(r.totalChange30d, 160);
  assert.deepEqual(r.tools.map(t => [t.tool, t.currentBytes, t.change7d, t.change30d]), [
    ['Claude', 260, 60, 160],
    ['Ollama', 10, 10, 10],
    ['Cursor', 40, -10, -10]
  ]);
});

test('growth: short and single-point histories', () => {
  const one = lib.computeGrowth([{ date: '2026-02-01', totalBytes: 5, perTool: { A: 5 } }]);
  assert.equal(one.totalChange7d, null);
  assert.equal(one.tools[0].change30d, null);
  assert.deepEqual(lib.computeGrowth([]).points, []);
  const short = lib.computeGrowth([
    { date: '2026-02-01', totalBytes: 5, perTool: { A: 5 } },
    { date: '2026-02-04', totalBytes: 9, perTool: { A: 9 } }
  ]);
  assert.equal(short.spanDays, 3);
  assert.equal(short.totalChange7d, 4, 'falls back to the oldest point');
  assert.equal(short.tools[0].change30d, 4);
});

test('growth alert: over threshold, at most once per day, off when unset', () => {
  const GB = 1024 ** 3;
  assert.equal(lib.shouldAlertGrowth(60 * GB, 50, null, '2026-01-02'), true);
  assert.equal(lib.shouldAlertGrowth(60 * GB, 50, '2026-01-02', '2026-01-02'), false);
  assert.equal(lib.shouldAlertGrowth(60 * GB, 50, '2026-01-01', '2026-01-02'), true);
  assert.equal(lib.shouldAlertGrowth(40 * GB, 50, null, '2026-01-02'), false);
  assert.equal(lib.shouldAlertGrowth(60 * GB, null, null, '2026-01-02'), false);
  assert.equal(lib.shouldAlertGrowth(60 * GB, 0, null, '2026-01-02'), false);
});

test('redaction: secrets inside longer strings (review findings)', () => {
  const R = '[redacted]';
  const cases = {
    'npx -y server --api-key abc123short': `npx -y server --api-key ${R}`,
    'set API_KEY=hunter2pass && npx x': `set API_KEY=${R} && npx x`,
    'Server=db;User Id=sa;Password=MyPass123;': `Server=db;User Id=sa;Password=${R};`,
    '--header=X-Api-Key: shortkey': `--header=X-Api-Key: ${R}`,
    'connect https://oauth.example.com:443/cb': 'connect https://oauth.example.com:443/cb'
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(lib.redactText(input), expected, input);
  assert.deepEqual(lib.redactArgs(['--header', 'X-Api-Key:', 'shortkey']), ['--header', 'X-Api-Key:', R]);
});

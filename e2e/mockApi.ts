import type { Page, Request } from '@playwright/test';
import { CLUTTER, DOCKER, DUPLICATES, GROWTH, MCP, WSL } from './mockFeatures';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

type Sw = { id: string; name: string; category: string; group?: string; status: string; size: number; ram?: number; procs?: number; version?: string; canUninstall?: boolean; cmd?: string };
const sw = (r: Sw) => ({
  id: r.id, name: r.name, category: r.category, group: r.group, status: r.status, version: r.version,
  detectionPaths: [`C:\\Users\\me\\AppData\\Local\\${r.name.replace(/\W+/g, '')}`],
  totalDiskSizeBytes: r.size, formattedDiskSize: r.size >= GB ? `${(r.size / GB).toFixed(1)} GB` : `${Math.round(r.size / MB)} MB`,
  ramMb: r.ram, processCount: r.procs, pid: r.ram ? 4200 : undefined, cpuPercent: r.ram ? 1 : undefined,
  description: `${r.name} — sample entry.`, canUninstall: r.canUninstall ?? r.group === undefined, manualCommand: r.cmd
});

// A realistic mix of every section on the Installed AI tools page.
export const SOFTWARE = [
  sw({ id: 'sw-claude', name: 'Claude', category: 'Assistant & agent CLI · Anthropic', status: 'ACTIVE IN RAM', size: 14.7 * GB, ram: 2900, procs: 20 }),
  sw({ id: 'sw-antigravity', name: 'Antigravity', category: 'Agentic IDE · Google', status: 'ACTIVE IN RAM', size: 24.9 * GB, ram: 2300, procs: 25, version: 'v2.11.0' }),
  sw({ id: 'app-zcode', name: 'ZCode', category: 'AI coding app · Z.ai', status: 'INSTALLED ON DISK', size: 1.2 * GB, version: 'v3.10.1' }),
  sw({ id: 'sw-cursor', name: 'Cursor', category: 'AI code editor · Anysphere', status: 'LAYING ON DISK (RESIDUAL)', size: 19 * MB }),
  sw({ id: 'feat-chrome', name: 'Google Chrome', category: 'Gemini in Chrome · Google', group: 'ai-feature', status: 'ACTIVE IN RAM', size: 495 * MB, ram: 2770, procs: 30, version: 'v153.0' }),
  sw({ id: 'feat-photoshop', name: 'Adobe Photoshop', category: 'Generative Fill · Adobe', group: 'ai-feature', status: 'INSTALLED ON DISK', size: 5.4 * GB, version: 'v27.10' }),
  sw({ id: 'tc-docker', name: 'Docker Desktop', category: 'Containers · Docker', group: 'toolchain', status: 'ACTIVE IN RAM', size: 50 * GB, ram: 2048, procs: 3, version: 'v4.83.0' }),
  sw({ id: 'tc-python', name: 'Python', category: 'Python runtime', group: 'toolchain', status: 'INSTALLED ON DISK', size: 1.4 * GB, version: 'v3.14.7' }),
  sw({ id: 'tc-node', name: 'Node.js', category: 'JavaScript runtime', group: 'toolchain', status: 'ACTIVE IN RAM', size: 564 * MB, ram: 656, procs: 31, version: 'v24.19.0' }),
  sw({ id: 'npm-playwright-mcp', name: 'Playwright MCP', category: 'npm global · @playwright/mcp', group: 'package', status: 'INSTALLED ON DISK', size: 17 * MB, version: 'v0.0.76', cmd: 'npm uninstall -g @playwright/mcp' }),
  sw({ id: 'py-onnxruntime', name: 'onnxruntime', category: 'Python library', group: 'package', status: 'INSTALLED ON DISK', size: 41 * MB, version: 'v1.26.0', cmd: 'pip uninstall onnxruntime' })
];

const item = (over: Record<string, unknown>) => ({
  category: 'Claude',
  formattedSize: '',
  canDelete: true,
  impactDescription: 'Rebuilt on next launch.',
  lastModified: '2026-09-20',
  safeReason: 'Disposable cache.',
  idleDays: 3,
  ...over
});

export const ITEMS = [
  item({ id: 'npm-cache', name: 'npm download cache', category: 'Dev Toolchain', path: 'C:\\Users\\me\\AppData\\Local\\npm-cache', sizeBytes: 2.6 * GB, formattedSize: '2.6 GB', tier: 'GREEN' }),
  item({ id: 'claude-data', name: 'Claude Desktop data', path: 'C:\\Users\\me\\AppData\\Roaming\\Claude', sizeBytes: 9.7 * GB, formattedSize: '9.7 GB', tier: 'YELLOW', impactDescription: 'Chats and settings.' }),
  item({
    id: 'docker-wsl-disk', name: 'Docker virtual disk', category: 'Dev Toolchain',
    path: 'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx',
    sizeBytes: 55 * GB, formattedSize: '55 GB', tier: 'RED', canDelete: false, trappedBytes: 44 * GB
  }),
  item({ id: 'chrome-cache', name: 'Google Chrome · Default — Cache', category: 'App caches', path: 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache', sizeBytes: 0.3 * GB, formattedSize: '300 MB', tier: 'GREEN' })
];

export interface MockLog {
  clean: unknown[];
  kill: unknown[];
  config: unknown[];
}

interface MockOptions {
  cleanStatus?: number;
  cleanBody?: unknown;
}

/** Route every call to the local engine to canned data and record writes. */
export async function mockApi(page: Page, opts: MockOptions = {}): Promise<MockLog> {
  const log: MockLog = { clean: [], kill: [], config: [] };
  let explorerPolls = 0;

  const handler = async (route: import('@playwright/test').Route, req: Request) => {
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    switch (url.pathname) {
      case '/api/scan':
        return json({
          items: ITEMS,
          processes: [{ pid: 4242, ppid: 1, name: 'node.exe', tool: 'MCP server: demo', cpuPercent: 0, memoryMb: 50, formattedMemory: '50 MB', isZombie: false, command: 'node demo.js' }],
          metrics: {
            totalAICacheBytes: 67 * GB, totalAICacheFormatted: '67 GB', totalAIProjectsBytes: 0, totalAIProjectsFormatted: '0 B',
            totalAIRAMBytes: 0, totalAIRAMMb: 50, totalAIRAMFormatted: '50 MB', reclaimableBytes: 2.9 * GB, reclaimableFormatted: '2.9 GB',
            hygieneScore: 80, itemCount: ITEMS.length, zombieProcessCount: 0, activeProcessCount: 1, lastScanTimestamp: new Date().toISOString()
          }
        });
      case '/api/snapshots': return json({ snapshots: [] });
      case '/api/config':
        if (req.method() === 'POST') { log.config.push(req.postDataJSON()); return json({ success: true }); }
        return json({ cacheThresholdGb: 20, restorePointPolicy: 'PROMPT', customRestorePath: 'C:\\Restore', reminderEnabled: false, reminderGb: 5 });
      case '/api/check-update': return json({ updateAvailable: false, currentVersion: 'v1.2.0' });
      case '/api/status':
        return json({
          drives: [{ root: 'C:\\', freeBytes: 22 * GB, totalBytes: 300 * GB }],
          recycleBin: { 'C:': { bytes: 17 * GB, usedBytes: 0, off: false } },
          scan: { running: false, phase: '', done: 0, total: 0 },
          lastScanAt: Date.now(), home: 'C:\\Users\\me', version: '1.2.0'
        });
      case '/api/inspect': {
        if (url.searchParams.get('live') === '1') {
          explorerPolls += 1;
          const done = explorerPolls > 1;
          return json({
            path: url.searchParams.get('path'), done, childCount: 2, totalBytes: 3 * GB, measuredAt: Date.now(),
            children: [
              { name: 'AppData', path: 'C:\\Users\\me\\AppData', bytes: done ? 2 * GB : 0, isDir: true, newestMtimeMs: Date.now(), pending: !done },
              { name: 'Downloads', path: 'C:\\Users\\me\\Downloads', bytes: 1 * GB, isDir: true, newestMtimeMs: Date.now() }
            ]
          });
        }
        return json({ path: url.searchParams.get('path'), done: true, childCount: 2, totalBytes: 2 * GB, measuredAt: Date.now(),
          children: [{ name: 'Cache_Data', path: 'x', bytes: 1.5 * GB, isDir: true, newestMtimeMs: 0 }, { name: 'index', path: 'y', bytes: 0.5 * GB, isDir: false, newestMtimeMs: 0 }] });
      }
      case '/api/clean':
        log.clean.push(req.postDataJSON());
        return json(opts.cleanBody ?? { success: true, cleanedCount: 1, requestedCount: 1, reclaimedFormatted: '2.6 GB' }, opts.cleanStatus ?? 200);
      case '/api/processes/kill':
        log.kill.push(req.postDataJSON());
        return json({ success: true });
      case '/api/system-tips': return json({ tips: [] });
      case '/api/reclaim-commands': return json({ commands: [] });
      case '/api/software': return json({ software: SOFTWARE });
      case '/api/docker/breakdown': return json(DOCKER);
      case '/api/wsl/distros': return json(WSL);
      case '/api/duplicate-models': return json(DUPLICATES);
      case '/api/project-clutter': return json(CLUTTER);
      case '/api/mcp-servers': return json(MCP);
      case '/api/growth': return json(GROWTH);
      default: return json({});
    }
  };
  await page.route('http://127.0.0.1:3333/**', handler);
  await page.route('http://localhost:3333/**', handler);
  return log;
}

/** Start with the tour already seen, on a given page. */
export async function openApp(page: Page, tab = 'DASHBOARD', tourDone = true): Promise<void> {
  await page.addInitScript(([t, done]) => {
    // First load of the test only — a reload must see what the app saved.
    if (sessionStorage.getItem('e2e-init')) return;
    sessionStorage.setItem('e2e-init', '1');
    localStorage.setItem('ai_hygiene_active_tab', t as string);
    if (done) localStorage.setItem('aicc_tour_done_v1', '1'); else localStorage.removeItem('aicc_tour_done_v1');
  }, [tab, tourDone]);
  await page.goto('/');
}

// Canned answers for the Docker & WSL, duplicate models, project clutter, MCP
// and growth endpoints. Generic sample data — no paths from a real machine.

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 86_400_000;
const now = Date.parse('2026-09-24T12:00:00Z');

export const DOCKER = {
  state: 'ok',
  types: [
    { type: 'Images', count: 14, active: 5, sizeBytes: 21 * GB, reclaimableBytes: 12 * GB, pruneKind: 'dangling-images' },
    { type: 'Containers', count: 6, active: 2, sizeBytes: 1.2 * GB, reclaimableBytes: 0.8 * GB },
    { type: 'Local Volumes', count: 4, active: 2, sizeBytes: 6 * GB, reclaimableBytes: 2 * GB },
    { type: 'Build Cache', count: 88, active: 0, sizeBytes: 9 * GB, reclaimableBytes: 9 * GB, pruneKind: 'build-cache' }
  ],
  disk: { path: 'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx', sizeBytes: 55 * GB, trappedBytes: 18 * GB, compactCommand: 'wsl --shutdown' },
  manual: [
    { id: 'containers', label: 'Stopped containers', commands: ['docker container prune'], warning: 'Anything saved inside a stopped container is lost.', severity: 'caution' },
    { id: 'volumes', label: 'Volumes', commands: ['docker volume ls', 'docker volume rm <volume-name>'], warning: 'May contain databases or model data — only delete volumes you recognise.', severity: 'danger' }
  ]
};

export const WSL = {
  distros: [
    { id: 'd1', name: 'Ubuntu', version: 2, isDefault: true, basePath: 'C:\\Users\\me\\AppData\\Local\\wsl\\ubuntu', vhdxPath: 'C:\\Users\\me\\AppData\\Local\\wsl\\ubuntu\\ext4.vhdx', sizeBytes: 12 * GB, managedByDocker: false, compactCommand: 'Optimize-VHD' },
    { id: 'd2', name: 'docker-desktop', version: 2, isDefault: false, basePath: 'C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\main', vhdxPath: null, sizeBytes: null, managedByDocker: true, compactCommand: null }
  ],
  compactSteps: ['Close every WSL app, then run: wsl --shutdown', 'Compact the disk file with Optimize-VHD or diskpart.']
};

const copy = (id: string, store: string, modelName: string, trashable: boolean, command?: string) => ({
  id, path: `C:\\Users\\me\\models\\${id}.gguf`, store, modelName, sizeBytes: 4.1 * GB, trashable, command,
  note: trashable ? 'A plain model file; another copy stays.' : 'Inside the store — remove it with the tool.'
});
export const DUPLICATES = {
  groups: [{
    id: 'g1', match: 'identical', sizeBytes: 4.1 * GB, formattedSize: '4.1 GB', savingsBytes: 4.1 * GB, formattedSavings: '4.1 GB',
    copies: [copy('c1', 'Ollama', 'llama3.1:8b', false, 'ollama rm llama3.1:8b'), copy('c2', 'LM Studio', 'Meta-Llama-3.1-8B-Q4_K_M', true)]
  }],
  totalSavingsBytes: 4.1 * GB, formattedTotalSavings: '4.1 GB', filesChecked: 12, scannedAt: new Date(now).toISOString()
};

const clutter = (id: string, project: string, kind: string, gb: number, idleDays: number) => ({
  id, projectPath: `D:\\code\\${project}`, kind, paths: [`D:\\code\\${project}\\${kind}`], sizeBytes: gb * GB, formattedSize: `${gb} GB`,
  projectLastTouchedMs: now - idleDays * DAY, idleDays, recent: idleDays < 14
});
export const CLUTTER = {
  items: [clutter('k1', 'old-shop', 'node_modules', 1.4, 210), clutter('k2', 'ml-notebook', '.venv', 2.2, 95), clutter('k3', 'current-app', 'node_modules', 0.9, 2)],
  totalBytes: 4.5 * GB, formattedTotal: '4.5 GB', roots: ['D:\\code'], truncated: false, dirsVisited: 900, recentDays: 14, scannedAt: new Date(now).toISOString()
};

export const MCP = {
  servers: [
    { id: 'm1', name: 'playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], envNames: [], clients: ['Claude Code', 'Cursor'],
      definitions: [{ client: 'Claude Code', configPath: 'C:\\Users\\me\\.claude.json', scope: 'global', disabled: false }], disabled: false,
      running: { processCount: 2, memoryMb: 180, cpuPercent: 0.4, pids: [1234, 1235] } },
    { id: 'm2', name: 'github', transport: 'stdio', command: 'npx', args: ['@modelcontextprotocol/server-github'], envNames: ['GITHUB_TOKEN'], clients: ['Claude Desktop'],
      definitions: [{ client: 'Claude Desktop', configPath: 'C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json', scope: 'global', disabled: false }], disabled: false, running: null }
  ],
  configs: [{ client: 'Claude Code', path: 'C:\\Users\\me\\.claude.json', status: 'ok', serverCount: 1 }]
};

const point = (daysAgo: number, gb: number) => ({ date: new Date(now - daysAgo * DAY).toISOString().slice(0, 10), totalBytes: gb * GB, perTool: { Claude: gb * 0.4 * GB } });
export const GROWTH = {
  points: [point(30, 58), point(21, 61), point(14, 63), point(7, 64), point(0, 67)],
  spanDays: 30, totalChange7d: 3 * GB, totalChange30d: 9 * GB,
  tools: [{ tool: 'Claude', currentBytes: 26 * GB, change7d: 1.2 * GB, change30d: 4 * GB }, { tool: 'Docker', currentBytes: 55 * GB, change7d: 800 * MB, change30d: 3 * GB }]
};

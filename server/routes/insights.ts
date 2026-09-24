import type { Express } from 'express';
import type { AIProcessItem } from '../../src/types';
import { listMcpServers } from '../mcpServers';
import { getGrowth } from '../growthHistory';

/** GET /api/mcp-servers and GET /api/growth. Both are read-only. */
export function registerInsightsRoutes(app: Express, deps: { getProcesses: () => Promise<AIProcessItem[]> }): void {
  app.get('/api/mcp-servers', async (_req, res) => {
    // Without live processes the inventory is still useful: nothing shows as running.
    const processes = await deps.getProcesses().catch(() => [] as AIProcessItem[]);
    try {
      res.json(await listMcpServers(processes));
    } catch {
      // No error detail: it could quote a config file that holds secrets.
      res.status(500).json({ error: 'Could not read MCP server configs.' });
    }
  });

  app.get('/api/growth', async (_req, res) => {
    try {
      res.json(await getGrowth());
    } catch {
      res.status(500).json({ error: 'Could not read growth history.' });
    }
  });
}

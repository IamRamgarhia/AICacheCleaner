import type { Express } from 'express';
import { getDockerBreakdown, isDockerPruneKind, pruneDocker } from '../dockerBreakdown';
import { getWslListing } from '../wslDistros';

export function registerDockerWslRoutes(app: Express): void {
  app.get('/api/docker/breakdown', async (_req, res) => {
    try {
      res.json(await getDockerBreakdown());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Only the two self-rebuilding cleanups; the caller names one, never a command.
  app.post('/api/docker/prune', async (req, res) => {
    try {
      const kind: unknown = req.body?.kind;
      if (!isDockerPruneKind(kind)) {
        return res.status(400).json({ error: 'kind must be "build-cache" or "dangling-images".' });
      }
      res.json(await pruneDocker(kind));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/wsl/distros', async (_req, res) => {
    try {
      res.json(await getWslListing());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}

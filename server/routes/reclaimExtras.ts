import type { Express, Request, Response } from 'express';
import type { DuplicateScanResult } from '../../src/lib/types/duplicates';
import type { ClutterScanResult, ClutterTrashResponse } from '../../src/lib/types/clutter';
import { findDuplicateModels, planDuplicateTrash, withoutCopy } from '../duplicateModels';
import { defaultClutterRoots, findProjectClutter, planClutterTrash, withoutClutter } from '../projectClutter';
import { deleteItemsSafely } from '../snapshotManager';
import { formatBytes } from '../scanner';

/**
 * Duplicate model files and project build clutter. Deletes go through
 * deleteItemsSafely (Recycle Bin only, capacity-checked) and accept only ids
 * from the last scan held here — never a path from the client.
 */

const DUP_ID = /^dup-[a-f0-9]{16}$/;
const CLUTTER_ID = /^clutter-[a-f0-9]{16}$/;
const MAX_IDS = 500;

let lastDuplicates: DuplicateScanResult | null = null;
let lastClutter: ClutterScanResult | null = null;
let duplicatesInFlight: Promise<DuplicateScanResult> | null = null;
let clutterInFlight: Promise<ClutterScanResult> | null = null;

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });
const isBody = (b: unknown): b is Record<string, unknown> => typeof b === 'object' && b !== null && !Array.isArray(b);

async function getDuplicates(_req: Request, res: Response) {
  try {
    duplicatesInFlight ??= findDuplicateModels().finally(() => { duplicatesInFlight = null; });
    lastDuplicates = await duplicatesInFlight;
    res.json(lastDuplicates);
  } catch (e) {
    fail(res, 500, `Could not look for duplicate models: ${(e as Error).message}`);
  }
}

async function trashDuplicate(req: Request, res: Response) {
  try {
    const body: unknown = req.body;
    if (!isBody(body) || typeof body.id !== 'string' || !DUP_ID.test(body.id) || Object.keys(body).length !== 1) {
      return fail(res, 400, 'Body must be { id } with a copy id from the last duplicate scan.');
    }
    if (!lastDuplicates) return fail(res, 409, 'Scan for duplicate models first.');
    const plan = await planDuplicateTrash(lastDuplicates, body.id);
    if (!plan.ok) return fail(res, plan.status, plan.error);

    const result = await deleteItemsSafely([plan.copy.path]);
    if (result.refused.length > 0) {
      return fail(res, 409, `Nothing was moved: ${result.refused.map(r => r.reason).join('; ')}.`);
    }
    if (result.movedToTrash.length === 0) {
      return fail(res, result.skipped.length > 0 ? 409 : 500, result.errors[0] ?? 'The file is no longer there. Rescan and try again.');
    }
    lastDuplicates = withoutCopy(lastDuplicates, body.id);
    res.json({
      moved: { id: plan.copy.id, path: plan.copy.path, sizeBytes: plan.copy.sizeBytes },
      reclaimedBytes: plan.copy.sizeBytes,
      reclaimedFormatted: formatBytes(plan.copy.sizeBytes),
      result: lastDuplicates
    });
  } catch (e) {
    fail(res, 500, (e as Error).message);
  }
}

async function getClutter(_req: Request, res: Response) {
  try {
    // ponytail: config.ts has no projectRoots setting yet, so roots are always the defaults.
    clutterInFlight ??= defaultClutterRoots().then(roots => findProjectClutter(roots)).finally(() => { clutterInFlight = null; });
    lastClutter = await clutterInFlight;
    res.json(lastClutter);
  } catch (e) {
    fail(res, 500, `Could not look for project clutter: ${(e as Error).message}`);
  }
}

function parseClutterBody(body: unknown): { ids: string[]; includeRecent: boolean } | string {
  if (!isBody(body)) return 'Body must be a JSON object.';
  const extra = Object.keys(body).filter(k => k !== 'ids' && k !== 'includeRecent');
  if (extra.length > 0) return `Unknown field(s): ${extra.join(', ')}.`;
  const { ids, includeRecent } = body;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return `ids must be an array of 1 to ${MAX_IDS} item ids.`;
  if (!ids.every((id): id is string => typeof id === 'string' && CLUTTER_ID.test(id))) return 'Every id must be an item id from the last clutter scan.';
  if (new Set(ids).size !== ids.length) return 'ids must not repeat.';
  if (includeRecent !== undefined && typeof includeRecent !== 'boolean') return 'includeRecent must be a boolean.';
  return { ids, includeRecent: includeRecent === true };
}

async function trashClutter(req: Request, res: Response) {
  try {
    const parsed = parseClutterBody(req.body);
    if (typeof parsed === 'string') return fail(res, 400, parsed);
    if (!lastClutter) return fail(res, 409, 'Scan for project clutter first.');

    const plan = planClutterTrash(lastClutter, parsed.ids, parsed.includeRecent);
    if (plan.unknown.length > 0) return fail(res, 400, `Not in the last scan (rescan and try again): ${plan.unknown.join(', ')}.`);

    const refused = [...plan.refused];
    const moved: ClutterTrashResponse['moved'] = [];
    if (plan.toMove.length > 0) {
      const result = await deleteItemsSafely(plan.toMove.flatMap(i => i.paths));
      if (result.refused.length > 0) {
        const reasons = [...new Set(result.refused.map(r => r.reason))].join('; ');
        const body: ClutterTrashResponse & { error: string } = {
          error: `Nothing was moved: ${reasons}.`,
          moved: [],
          refused: [...refused, ...plan.toMove.map(i => ({ id: i.id, reason: reasons }))],
          reclaimedBytes: 0,
          reclaimedFormatted: formatBytes(0)
        };
        return res.status(409).json(body);
      }
      const movedSet = new Set(result.movedToTrash);
      const skippedSet = new Set(result.skipped);
      for (const item of plan.toMove) {
        const went = item.paths.filter(p => movedSet.has(p));
        if (went.length === item.paths.length) {
          moved.push({ id: item.id, paths: went, sizeBytes: item.sizeBytes });
          continue;
        }
        if (went.length > 0) moved.push({ id: item.id, paths: went, sizeBytes: 0 });
        const failed = item.paths.filter(p => !movedSet.has(p));
        const error = result.errors.find(e => failed.some(p => e.includes(p)));
        refused.push({
          id: item.id,
          reason: error ?? (failed.every(p => skippedSet.has(p)) ? 'the folder no longer exists' : 'it could not be moved')
        });
      }
      const handled = new Set(plan.toMove
        .filter(i => i.paths.some(p => movedSet.has(p) || skippedSet.has(p)))
        .map(i => i.id));
      lastClutter = withoutClutter(lastClutter, handled);
    }

    const reclaimedBytes = moved.reduce((sum, m) => sum + m.sizeBytes, 0);
    const response: ClutterTrashResponse = { moved, refused, reclaimedBytes, reclaimedFormatted: formatBytes(reclaimedBytes) };
    res.json(response);
  } catch (e) {
    fail(res, 500, (e as Error).message);
  }
}

// Moves run one at a time: two requests for the two copies of one model would
// otherwise both see "another copy remains" and both go to the Recycle Bin.
let moveQueue: Promise<unknown> = Promise.resolve();
const oneAtATime = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  const run = moveQueue.then(() => handler(req, res));
  moveQueue = run.catch(() => undefined);
  return run;
};

export function registerReclaimExtrasRoutes(app: Express): void {
  app.get('/api/duplicate-models', getDuplicates);
  app.post('/api/duplicate-models/trash', oneAtATime(trashDuplicate));
  app.get('/api/project-clutter', getClutter);
  app.post('/api/project-clutter/trash', oneAtATime(trashClutter));
}

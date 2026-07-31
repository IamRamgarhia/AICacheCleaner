import fsp from 'fs/promises';

/**
 * Run an async mapper over `items` with at most `limit` in flight.
 *
 * Everything in the scan path uses this instead of a bare `Promise.all` so a
 * directory with 50k files cannot exhaust the process file-descriptor limit.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/** `fs.existsSync` without blocking the event loop. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/** `fs.statSync` that resolves to null instead of throwing on locked/missing paths. */
export async function statSafe(target: string) {
  try {
    return await fsp.stat(target);
  } catch {
    return null;
  }
}

/** `fs.readdirSync(withFileTypes)` that resolves to [] instead of throwing. */
export async function readdirSafe(target: string) {
  try {
    return await fsp.readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
}

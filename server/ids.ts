import crypto from 'crypto';
import path from 'path';

/**
 * Stable, collision-free item id from a path. Replacing punctuation with '-'
 * made "model_v1"/"model-v1" (and any two non-Latin folder names) share an id,
 * so selecting one selected — and cleaned — both.
 */
export function stableId(prefix: string, p: string): string {
  const hash = crypto.createHash('sha1').update(path.normalize(p).toLowerCase()).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
}

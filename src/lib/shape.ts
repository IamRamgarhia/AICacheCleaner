/**
 * Throw when an API response is missing the arrays a page renders from, so the
 * page shows its error message instead of crashing on `undefined.length`.
 */
export function requireArrays<T>(body: unknown, keys: string[]): T {
  const o = body as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || keys.some(k => !Array.isArray(o[k]))) {
    throw new Error('The engine sent an unexpected answer. Try again, or restart the app.');
  }
  return body as T;
}

const OLD_ENGINE =
  'This page needs a newer engine than the one running. An older AICacheCleaner is probably still open ' +
  '(check the system tray) — close it, then start this version again.';

/**
 * Parse an engine response. A 404 web page instead of JSON means the engine on
 * port 3333 is an older version without this feature, so say that plainly.
 */
export type ApiBody = { error?: string } & Record<string, unknown>;

export async function apiJson(res: Response, opts: { allowErrorBody?: boolean } = {}): Promise<ApiBody> {
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(res.status === 404 ? OLD_ENGINE : `The engine answered with status ${res.status}.`);
  }
  const body = (await res.json()) as ApiBody;
  if (!res.ok && !opts.allowErrorBody) throw new Error(typeof body.error === 'string' ? body.error : `The engine answered with status ${res.status}.`);
  return body;
}

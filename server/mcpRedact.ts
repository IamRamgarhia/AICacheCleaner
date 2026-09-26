// Redaction for MCP server definitions. Client configs routinely hold API keys
// in args, URLs and headers; everything shown to the UI passes through here.
// Err towards redacting: a hidden package name is an annoyance, a leaked key
// is not recoverable.

export const REDACTED = '[redacted]';

const SECRET_WORD = 'key|token|secret|password|passwd|pwd|auth|credential|cookie|bearer';
/** `--token`, `--api-key`, `-password` … : the NEXT arg is the secret. */
const SECRET_FLAG = new RegExp(String.raw`^-{1,2}[\w.-]*(?:${SECRET_WORD})[\w.-]*$`, 'i');
/** `--token=x`, `API_KEY=x`, `-e GITHUB_TOKEN=x`. */
const SECRET_ASSIGN = new RegExp(String.raw`^(-{0,2}[\w.-]*(?:${SECRET_WORD})[\w.-]*)=(.+)$`, 'is');
/** `X-Api-Key: x`, `Authorization: Bearer x` passed as a header arg. */
const SECRET_HEADER = new RegExp(String.raw`^([\w-]*(?:${SECRET_WORD}|authorization)[\w-]*)\s*:\s*(.+)$`, 'is');
const SECRET_PARAM = /key|token|secret|pass|pwd|auth|sig|credential|session/i;
/** An arg ending in `Api-Key:` or `TOKEN=` — its value is the next arg. */
const SECRET_TRAILER = new RegExp(String.raw`(?:${SECRET_WORD}|authorization)[\w-]*\s*[:=]$`, 'i');

// Known credential prefixes, anchored to a token boundary so a package name
// such as "task-master-ai" (which contains "sk-") survives.
const PREFIXED = /(^|[^A-Za-z0-9])((?:sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abprs]-|AIza)[A-Za-z0-9_.-]{6,})/g;
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[^\s"',;]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RUN = /[A-Za-z0-9+/=_-]{24,}/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/**
 * Long base64/hex run that is a credential rather than a path or a
 * hyphenated package name.
 */
function isSecretRun(run: string): boolean {
  if (/^[0-9a-f]{24,}$/i.test(run)) return true;
  // Two or more slashes: usually a path. Still catch base64 that happens to
  // contain slashes: a long mixed-case-and-digit segment is not a folder name.
  if ((run.match(/\//g)?.length ?? 0) >= 2) {
    return run.split('/').some(seg => seg.length >= 16 && /\d/.test(seg) && /[a-z]/.test(seg) && /[A-Z]/.test(seg));
  }
  const longest = Math.max(...run.replace(/=+$/, '').split(/[-_]/).map(s => s.length));
  return longest >= 20 && /\d/.test(run) && /[a-z]/i.test(run);
}

/** Drop user:pass@ and the values of secret-looking query/fragment params. */
export function redactUrl(url: string): string {
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@\s]*@/i, `$1${REDACTED}@`)
    .replace(/([?&#;])([^=&#;?]+)=([^&#;]*)/g, (m, sep: string, k: string) =>
      SECRET_PARAM.test(k) ? `${sep}${k}=${REDACTED}` : m
    );
}

/**
 * Secrets inside a longer string: `set API_KEY=x && npx …`, `Server=db;Password=x;`,
 * `--header=X-Api-Key: x`. A colon only counts when followed by a space, so
 * `https://oauth.example.com:443` is not mistaken for one.
 */
const ASSIGN_ANYWHERE = new RegExp(String.raw`([\w.-]*(?:${SECRET_WORD})[\w.-]*)(=|:\s+)(?!\[redacted\])([^\s;&"',]+)`, 'gi');
/** `… --api-key abc …` within one string: the word after a secret flag. */
const FLAG_THEN_VALUE = new RegExp(String.raw`((?:^|\s)-{1,2}[\w.-]*(?:${SECRET_WORD})[\w.-]*\s+)(?!-)(\S+)`, 'gi');

/** Redact every secret-looking part of one string (an arg, command or URL). */
export function redactText(text: string): string {
  let s = text.replace(URL_RE, redactUrl);
  const assign = s.match(SECRET_ASSIGN);
  if (assign && !/\s/.test(s)) return `${assign[1]}=${REDACTED}`;
  const header = s.match(SECRET_HEADER);
  if (header) return `${header[1]}: ${REDACTED}`;
  s = s
    .replace(ASSIGN_ANYWHERE, (_m, k: string, sep: string) => `${k}${sep}${REDACTED}`)
    .replace(FLAG_THEN_VALUE, (_m, flag: string) => `${flag}${REDACTED}`);
  s = s
    .replace(PREFIXED, (_m, pre: string) => `${pre}${REDACTED}`)
    .replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(UUID, REDACTED)
    .replace(RUN, run => (isSecretRun(run) ? REDACTED : run));
  return s;
}

/** Redact an argv list, including values that follow a secret flag. */
export function redactArgs(args: readonly string[]): string[] {
  return args.map((arg, i) => {
    const prev = i > 0 ? args[i - 1] : '';
    // `--token value`, and `--header=X-Api-Key:` followed by the value as its own arg.
    if ((SECRET_FLAG.test(prev) || SECRET_TRAILER.test(prev)) && !arg.startsWith('-')) return REDACTED;
    return redactText(arg);
  });
}

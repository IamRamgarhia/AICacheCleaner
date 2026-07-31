// Shared item classification helpers.
//
// These used to be inlined in TargetListTable with hardcoded literals — the
// activity filter compared against the string '2026-07' and the compact view
// whitelisted the original developer's own folder paths. Both produced correct
// output only during July 2026 on one specific machine.

/** Items touched within this many days count as "active". */
export const RECENT_WINDOW_DAYS = 30;

/** File extensions that mark a folder as downloaded media rather than a project. */
export const JUNK_EXTENSIONS = [
  '.avif', '.crdownload', '.doc', '.docx', '.exe', '.gz', '.jpeg', '.jpg',
  '.png', '.gif', '.svg', '.webp', '.psd', '.ai', '.pdf', '.xlsx', '.pptx',
  '.zip', '.rar', '.7z', '.tar', '.dll', '.iso', '.mp4', '.avi', '.mov', '.mp3'
];

/**
 * True when `lastModified` (an ISO yyyy-mm-dd string from the scanner) falls
 * within the rolling recent window. Unparseable dates are treated as NOT
 * recent, so unknown items sort to the bottom rather than the top.
 */
export function isRecentlyModified(lastModified: string, now: number = Date.now()): boolean {
  const parsed = Date.parse(lastModified);
  if (Number.isNaN(parsed)) return false;
  const cutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Guard against clock skew / future timestamps counting as stale.
  return parsed >= cutoff;
}

/** Human label for the activity column. */
export function activityLabel(lastModified: string): string {
  return isRecentlyModified(lastModified) ? 'Active' : 'Untouched';
}

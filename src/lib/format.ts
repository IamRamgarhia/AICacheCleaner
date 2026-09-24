export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`;
}

export function idleLabel(idleDays?: number, fallback = ''): string {
  if (typeof idleDays !== 'number') return fallback;
  return idleDays === 0 ? 'changed today' : `untouched ${idleDays}d`;
}

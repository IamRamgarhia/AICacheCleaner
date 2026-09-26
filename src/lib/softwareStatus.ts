import type { AISoftwareAppItem, SoftwareGroup } from '../types';

export interface StatusLabel { label: string; tone: 'running' | 'left' | 'idle' }

/**
 * One word for what state a tool is in. "Installed" only when there's proof
 * (Windows lists it, or it's a runtime/package we found by its executable);
 * folders found by name alone are just "On disk".
 */
export function statusOf(item: AISoftwareAppItem): StatusLabel {
  if (item.status === 'ACTIVE IN RAM') return { label: 'Running', tone: 'running' };
  if (item.status === 'LAYING ON DISK (RESIDUAL)') return { label: 'Left behind', tone: 'left' };
  if (item.group === 'model') return { label: 'Downloaded', tone: 'idle' };
  const proven = (item.group && item.group !== 'ai') || !!item.version || !!item.iconPath;
  return { label: proven ? 'Installed' : 'On disk', tone: 'idle' };
}

export const GROUPS: { id: SoftwareGroup; title: string }[] = [
  { id: 'ai', title: 'AI apps and agents' },
  { id: 'model', title: 'AI models' },
  { id: 'ai-feature', title: 'Apps with AI built in' },
  { id: 'toolchain', title: 'Software AI tools rely on' },
  { id: 'package', title: 'Packages AI tools installed' }
];

export type SortKey = 'name' | 'size' | 'memory';
export interface Sort { key: SortKey; desc: boolean }

const compare = (sort: Sort) => (a: AISoftwareAppItem, b: AISoftwareAppItem): number => {
  const v = sort.key === 'name'
    ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    : sort.key === 'size'
      ? a.totalDiskSizeBytes - b.totalDiskSizeBytes
      : (a.ramMb ?? -1) - (b.ramMb ?? -1);
  return sort.desc ? -v : v;
};

/** Rows in display order, skipping collapsed groups — also what arrow keys walk. */
export function visibleRows(items: AISoftwareAppItem[], sort: Sort, collapsed: Set<SoftwareGroup>) {
  return GROUPS.map(g => {
    const rows = items.filter(i => (i.group ?? 'ai') === g.id).sort(compare(sort));
    return { ...g, rows, total: rows.reduce((a, r) => a + r.totalDiskSizeBytes, 0), open: !collapsed.has(g.id) };
  }).filter(g => g.rows.length > 0);
}

import React, { useMemo } from 'react';
import type { AISoftwareAppItem, SoftwareGroup } from '../types';
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { formatBytes } from '../lib/format';
import { statusOf, visibleRows, type Sort, type SortKey } from '../lib/softwareStatus';

interface SoftwareListProps {
  items: AISoftwareAppItem[];
  selectedId: string | null;
  sort: Sort;
  collapsed: Set<SoftwareGroup>;
  onSort: (key: SortKey) => void;
  onToggleGroup: (group: SoftwareGroup) => void;
  onSelect: (id: string | null) => void;
  onOpen: (item: AISoftwareAppItem) => void;
  onContextMenu: (item: AISoftwareAppItem, e: React.MouseEvent) => void;
}

export const SoftwareList: React.FC<SoftwareListProps> = ({ items, selectedId, sort, collapsed, onSort, onToggleGroup, onSelect, onOpen, onContextMenu }) => {
  const groups = useMemo(() => visibleRows(items, sort, collapsed), [items, sort, collapsed]);

  const head = (key: SortKey, label: string, numeric = false) => (
    <th className={numeric ? 'ins-num' : undefined} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => onSort(key)}>
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );

  return (
    <table className="ins-list" aria-label="Installed software">
      <colgroup>
        <col />
        <col style={{ width: 118 }} />
        <col style={{ width: 128 }} />
        <col style={{ width: 96 }} />
        <col style={{ width: 104 }} />
      </colgroup>
      <thead>
        <tr>
          {head('name', 'Name')}
          <th>Status</th>
          <th>Version</th>
          {head('size', 'Size', true)}
          {head('memory', 'Memory', true)}
        </tr>
      </thead>
      <tbody>
        {groups.map(g => (
          <React.Fragment key={g.id}>
            <tr className="ins-group-row">
              <td colSpan={5}>
                <button onClick={() => onToggleGroup(g.id)} aria-expanded={g.open}>
                  {g.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {g.title}
                </button>
                <span className="ins-meta ins-data">{g.rows.length} · {formatBytes(g.total)}</span>
              </td>
            </tr>
            {g.open && g.rows.map(item => {
              const status = statusOf(item);
              return (
                <tr
                  key={item.id}
                  id={`sw-row-${item.id}`}
                  className={`ins-row${item.id === selectedId ? ' is-selected' : ''}`}
                  aria-selected={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => onOpen(item)}
                  onContextMenu={e => onContextMenu(item, e)}
                >
                  <td>
                    <div className="ins-appcell">
                      <AppIcon name={item.name} category={item.category} iconPath={item.iconPath} iconDataUrl={item.iconDataUrl} />
                      <span className="ins-appcell-text" title={`${item.name} — ${item.category}`}>
                        {item.name}
                        <span className="ins-appcell-sub">{item.category}</span>
                      </span>
                    </div>
                  </td>
                  <td><span className={`ins-status ins-status--${status.tone}`}>{status.label}</span></td>
                  <td className="ins-meta">{item.version ?? ''}</td>
                  <td className="ins-num ins-data">{item.totalDiskSizeBytes > 0 ? item.formattedDiskSize : '—'}</td>
                  <td className="ins-num ins-data">{item.status === 'ACTIVE IN RAM' ? formatBytes((item.ramMb ?? 0) * 1024 * 1024) : ''}</td>
                </tr>
              );
            })}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
};

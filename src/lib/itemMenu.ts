import type React from 'react';
import type { AICacheItem } from '../types';
import { showContextMenu } from './native';

export interface ItemMenuActions {
  onOpenFolder: (path: string) => void;
  onDelete?: (id: string) => void;
  onShowDetails?: (item: AICacheItem) => void;
}

/**
 * Right-click on any storage row: Open folder / Copy path / Details / Delete.
 * Delete only routes to the normal caution dialog — it never deletes directly.
 * Outside Electron the browser's own menu is left alone.
 */
export async function openItemMenu(e: React.MouseEvent, item: AICacheItem, actions: ItemMenuActions): Promise<void> {
  if (!(window as unknown as { electronAPI?: unknown }).electronAPI) return;
  e.preventDefault();
  const chosen = await showContextMenu([
    { id: 'open', label: 'Open folder' },
    { id: 'copy', label: 'Copy path' },
    ...(actions.onShowDetails ? [{ id: 'details', label: 'Show details' }] : []),
    ...(actions.onDelete ? [{ separator: true }, { id: 'delete', label: 'Delete…', enabled: item.canDelete }] : [])
  ]);
  if (chosen === 'open') actions.onOpenFolder(item.path);
  if (chosen === 'copy') void navigator.clipboard?.writeText(item.path);
  if (chosen === 'details') actions.onShowDetails?.(item);
  if (chosen === 'delete' && item.canDelete) actions.onDelete?.(item.id);
}

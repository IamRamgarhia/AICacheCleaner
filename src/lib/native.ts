/**
 * Native OS dialogs and menus when running inside Electron, with browser
 * fallbacks so the UI still works in `vite` dev and in tests.
 */
interface ConfirmOptions {
  title?: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface MenuItem {
  id?: string;
  label?: string;
  enabled?: boolean;
  separator?: boolean;
}

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  alert: (o: { title?: string; message: string; detail?: string; kind?: 'info' | 'error' }) => Promise<void>;
  pickFolder: (o: { title?: string; defaultPath?: string }) => Promise<string | null>;
  contextMenu: (items: MenuItem[]) => Promise<string | null>;
  onCommand: (handler: (cmd: string) => void) => () => void;
}

const api = (): ElectronAPI | undefined => (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

export const isElectron = (): boolean => Boolean(api()?.isElectron);

export async function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  const native = api();
  if (native?.confirm) return native.confirm(o);
  return window.confirm([o.message, o.detail].filter(Boolean).join('\n\n'));
}

export async function alertDialog(message: string, detail?: string, kind: 'info' | 'error' = 'info'): Promise<void> {
  const native = api();
  if (native?.alert) return native.alert({ message, detail, kind });
  window.alert([message, detail].filter(Boolean).join('\n\n'));
}

/** Native folder picker; null when cancelled or unavailable (browser dev). */
export async function pickFolder(title?: string, defaultPath?: string): Promise<string | null> {
  const native = api();
  return native?.pickFolder ? native.pickFolder({ title, defaultPath }) : null;
}

/**
 * Right-click menu. Native in Electron; in a browser it resolves null so the
 * caller can fall back to its own UI (or do nothing).
 */
export async function showContextMenu(items: MenuItem[]): Promise<string | null> {
  const native = api();
  return native?.contextMenu ? native.contextMenu(items) : null;
}

export interface UpdateAsset { name: string; downloadUrl: string; sizeBytes: number; digest?: string }

/**
 * Download a release asset to Downloads (Electron only). Resolves with where it
 * was saved and whether its SHA-256 was verified; the file is never run.
 */
export async function downloadUpdate(
  asset: UpdateAsset,
  onProgress: (received: number, total: number) => void
): Promise<{ ok: boolean; path?: string; verified?: boolean; error?: string }> {
  const native = (window as unknown as {
    electronAPI?: { downloadUpdate?: (a: object, cb: (p: { received: number; total: number }) => void) => Promise<{ ok: boolean; path?: string; verified?: boolean; error?: string }> };
  }).electronAPI;
  if (!native?.downloadUpdate) return { ok: false, error: 'Downloading updates works in the desktop app only.' };
  return native.downloadUpdate({ url: asset.downloadUrl, name: asset.name, digest: asset.digest }, p => onProgress(p.received, p.total));
}

/** Commands sent from the tray / main process (e.g. "rescan"). */
export function onAppCommand(handler: (cmd: string) => void): () => void {
  return api()?.onCommand?.(handler) ?? (() => undefined);
}

const icons = new Map<string, Promise<string | null>>();

/** An app's own icon as a data URL (Electron only); null in the browser or when it has none. */
export function fileIcon(exePath: string): Promise<string | null> {
  const native = (window as unknown as { electronAPI?: { fileIcon?: (p: string) => Promise<string | null> } }).electronAPI;
  if (!native?.fileIcon) return Promise.resolve(null);
  if (!icons.has(exePath)) icons.set(exePath, native.fileIcon(exePath).catch(() => null));
  return icons.get(exePath)!;
}

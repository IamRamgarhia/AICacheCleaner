/** Shared between server/projectClutter.ts and the Project clutter tab. */

export type ClutterKind =
  | 'node_modules' | '.venv' | 'venv' | '__pycache__' | 'target'
  | '.next' | '.nuxt' | '.turbo' | '.parcel-cache' | 'dist' | 'build';

export interface ClutterItem {
  /** Opaque id the client sends back; the server never accepts a raw path. */
  id: string;
  projectPath: string;
  kind: ClutterKind;
  /** Folders that move together (several for __pycache__, one otherwise). */
  paths: string[];
  sizeBytes: number;
  formattedSize: string;
  /** Newest source-file mtime in the project, clutter folders excluded. 0 = unknown. */
  projectLastTouchedMs: number;
  idleDays?: number;
  /** Touched within the safety window: refused unless includeRecent is sent. */
  recent: boolean;
}

export interface ClutterScanResult {
  items: ClutterItem[];
  totalBytes: number;
  formattedTotal: string;
  roots: string[];
  /** Hit the directory cap; some folders were not searched. */
  truncated: boolean;
  dirsVisited: number;
  recentDays: number;
  scannedAt: string;
}

export interface ClutterTrashResponse {
  moved: { id: string; paths: string[]; sizeBytes: number }[];
  refused: { id: string; reason: string }[];
  reclaimedBytes: number;
  reclaimedFormatted: string;
}

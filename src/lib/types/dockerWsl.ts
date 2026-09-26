// Shared by the server (server/dockerBreakdown.ts, server/wslDistros.ts) and the
// Docker & WSL page.

/** The only two Docker cleanups the app runs itself: both rebuild or re-download on demand. */
export const DOCKER_PRUNE_KINDS = ['build-cache', 'dangling-images'] as const;
export type DockerPruneKind = (typeof DOCKER_PRUNE_KINDS)[number];

export type DockerState = 'ok' | 'not-installed' | 'not-running';

export interface DockerTypeUsage {
  /** Docker's own label: "Images", "Containers", "Local Volumes", "Build Cache". */
  type: string;
  count: number;
  active: number;
  sizeBytes: number;
  reclaimableBytes: number;
  /** Set on the rows the app can clean itself. */
  pruneKind?: DockerPruneKind;
}

/** A cleanup the user runs themselves, with what it destroys. */
export interface DockerManualCleanup {
  id: 'containers' | 'unused-images' | 'volumes';
  label: string;
  commands: string[];
  warning: string;
  severity: 'caution' | 'danger';
}

export interface DockerVirtualDisk {
  path: string;
  sizeBytes: number;
  /** File size minus what Docker stores: what a compact hands back. Null when unknown. */
  trappedBytes: number | null;
  compactCommand: string | null;
}

export interface DockerBreakdown {
  state: DockerState;
  /** Why Docker could not be read, in plain words. */
  message?: string;
  types: DockerTypeUsage[];
  disk: DockerVirtualDisk | null;
  manual: DockerManualCleanup[];
}

export interface DockerPruneResult {
  ok: boolean;
  /** Docker's "Total reclaimed space" figure, e.g. "1.2GB". */
  reclaimed: string | null;
  output: string;
}

export interface WslDistro {
  id: string;
  name: string;
  version: 1 | 2;
  isDefault: boolean;
  basePath: string;
  /** WSL 2 only; WSL 1 keeps files in a plain folder. */
  vhdxPath: string | null;
  sizeBytes: number | null;
  managedByDocker: boolean;
  compactCommand: string | null;
}

export interface WslListing {
  distros: WslDistro[];
  compactSteps: string[];
}

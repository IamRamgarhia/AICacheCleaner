export type SafetyTier = 'GREEN' | 'YELLOW' | 'RED';

export type AICacheItem = {
  id: string;
  name: string;
  category: 'Antigravity' | 'Cursor' | 'Windsurf' | 'Claude' | 'ChatGPT' | 'Ollama' | 'HuggingFace' | 'MCP Memory' | 'Vector DB' | 'VS Code Extension';
  path: string;
  sizeBytes: number;
  formattedSize: string;
  tier: SafetyTier;
  canDelete: boolean;
  impactDescription: string;
  lastModified: string;
  safeReason?: string;
  isOrphaned?: boolean;
  projectExists?: boolean;
  // Set by the scanner when the folder actually contains a dev-server entry
  // point (package.json, vite/next config, app.py...). Replaces the old
  // hardcoded `path.includes('calude')` check that only ever matched the
  // original developer's own machine.
  isRunnableProject?: boolean;
};

export type AIProcessItem = {
  pid: number;
  ppid: number;
  name: string;
  tool: string;
  cpuPercent: number;
  memoryMb: number;
  formattedMemory: string;
  isZombie: boolean;
  command: string;
};

export type SystemMetrics = {
  totalAICacheBytes: number;
  totalAICacheFormatted: string;
  totalAIProjectsBytes: number;
  totalAIProjectsFormatted: string;
  totalAIRAMBytes: number;
  totalAIRAMMb: number;
  totalAIRAMFormatted: string;
  reclaimableBytes: number;
  reclaimableFormatted: string;
  hygieneScore: number; // 0 - 100
  itemCount: number;
  zombieProcessCount: number;
  activeProcessCount: number;
  lastScanTimestamp: string;
};

export type SnapshotItem = {
  snapshotId: string;
  timestamp: string;
  itemCount: number;
  totalSizeBytes: number;
  formattedSize: string;
  items: AICacheItem[];
  note?: string;
  // Optional custom restore destination the user picked at snapshot-creation
  // time; surfaced back to the restore flow when present.
  restoreFolderPath?: string;
};

export type MigrationPackage = {
  projectName: string;
  sourceApp: string;
  targetApp: string;
  chatCount: number;
  vectorIndexSize: string;
  mcpServersCount: number;
  timestamp: string;
};

export type AISoftwareAppItem = {
  id: string;
  name: string;
  category: string;
  // Only set when a real version could be read from the installed app. It was
  // previously a hardcoded string shown to users as a detected fact.
  version?: string;
  status: 'ACTIVE IN RAM' | 'INSTALLED ON DISK' | 'LAYING ON DISK (RESIDUAL)' | 'NOT INSTALLED';
  detectionPaths: string[];
  executableName?: string;
  pid?: number;
  ramMb?: number;
  cpuPercent?: number;
  totalDiskSizeBytes: number;
  formattedDiskSize: string;
  description: string;
  canUninstall: boolean;
  // Real on-disk cache locations detected for this software, populated by the
  // detector. Lets the purge flow snapshot the actual software caches instead
  // of an empty list.
  detectedCaches?: AICacheItem[];
};


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
  totalAIRAMFormatted: string;
  reclaimableBytes: number;
  reclaimableFormatted: string;
  hygieneScore: number; // 0 - 100
  itemCount: number;
  zombieProcessCount: number;
};

export type SnapshotItem = {
  snapshotId: string;
  timestamp: string;
  itemCount: number;
  totalSizeBytes: number;
  formattedSize: string;
  items: AICacheItem[];
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
  version: string;
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
};


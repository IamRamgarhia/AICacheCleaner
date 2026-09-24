// Shared between the server (/api/mcp-servers) and the MCP servers tab.
// Nothing here may carry a secret: env values, headers and raw process command
// lines are never sent; args and URLs are redacted server-side.

export type McpTransport = 'stdio' | 'http' | 'sse';

/** One place a server is defined: which client, which file, which scope. */
export interface McpDefinition {
  client: string;
  configPath: string;
  /** 'global', or the project folder the definition is scoped to. */
  scope: string;
  disabled: boolean;
}

export interface McpRunning {
  processCount: number;
  memoryMb: number;
  cpuPercent: number;
  pids: number[];
}

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  /** Redacted. */
  command?: string;
  /** Redacted. */
  args: string[];
  /** Redacted (credentials and secret-looking query params removed). */
  url?: string;
  /** Names only — values are never read out of the config. */
  envNames: string[];
  clients: string[];
  definitions: McpDefinition[];
  /** True only when every definition is disabled. */
  disabled: boolean;
  /** Null when no running process matched. */
  running: McpRunning | null;
}

export interface McpConfigFile {
  client: string;
  path: string;
  status: 'ok' | 'unreadable';
  serverCount: number;
  /** Generic reason; never contains file content. */
  error?: string;
}

export interface McpInventory {
  servers: McpServer[];
  configs: McpConfigFile[];
}

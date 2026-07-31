// Ambient type declarations for modules that ship without their own types.
// Keep this minimal and permissive so the type-checker (tsc --noEmit) and the
// runtime bundlers (tsx / esbuild) agree, without pulling in heavy @types deps.

declare module 'pidusage' {
  export interface PidStat {
    pid: number;
    cpu: number;      // CPU percentage (0-100, may exceed on multi-core)
    memory: number;   // Resident memory in bytes
    ppid?: number;
    ctime: number;    // CPU time in ms
    elapsed: number;  // Process elapsed time in ms
    timestamp: number;
  }

  type PidStats = { [pid: number]: PidStat };

  interface PidusageFn {
    (pids: number | number[]): Promise<PidStats>;
    clear(): void;
    uninstall?(): void;
  }

  const pidusage: PidusageFn;
  export default pidusage;
}

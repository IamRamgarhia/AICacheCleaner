import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseDockerSize, dockerStoredBytes } from './dockerUsage';
import { compactCommandFor } from './wslDistros';
import {
  DOCKER_PRUNE_KINDS,
  type DockerBreakdown,
  type DockerManualCleanup,
  type DockerPruneKind,
  type DockerPruneResult,
  type DockerTypeUsage,
  type DockerVirtualDisk
} from '../src/lib/types/dockerWsl';

const execFileAsync = promisify(execFile);

/** Injected in tests so nothing here needs Docker installed. */
export type Exec = (bin: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: Exec = (bin, args, timeoutMs) =>
  execFileAsync(bin, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
// Current Docker Desktop first, then the pre-4.30 layout.
const DOCKER_DISKS = process.platform === 'win32'
  ? [
      path.join(localAppData, 'Docker', 'wsl', 'disk', 'docker_data.vhdx'),
      path.join(localAppData, 'Docker', 'wsl', 'data', 'ext4.vhdx')
    ]
  : [];

// Never `docker system prune`, never `--volumes`: these two rebuild or
// re-download on demand, nothing else is run from the app.
const PRUNE_ARGS: Record<DockerPruneKind, string[]> = {
  'build-cache': ['builder', 'prune', '-f'],
  'dangling-images': ['image', 'prune', '-f']
};

const PRUNE_KIND_BY_TYPE: Record<string, DockerPruneKind> = {
  'Build Cache': 'build-cache',
  Images: 'dangling-images'
};

export const DOCKER_MANUAL_CLEANUPS: DockerManualCleanup[] = [
  {
    id: 'containers',
    label: 'Stopped containers',
    commands: ['docker container prune'],
    warning:
      'Deletes every stopped container and anything written inside it that is not in a volume (files, logs, settings). ' +
      'A container you meant to start again is gone for good.',
    severity: 'caution'
  },
  {
    id: 'unused-images',
    label: 'Unused images',
    commands: ['docker image prune -a'],
    warning:
      'Deletes every image no container uses, including ones you pulled on purpose. ' +
      'They are downloaded again the next time you run them — slow for large AI images, impossible offline.',
    severity: 'caution'
  },
  {
    id: 'volumes',
    label: 'Volumes',
    commands: ['docker volume ls', 'docker volume rm <volume-name>'],
    warning:
      'Volumes may contain databases or model data — only delete volumes you recognise. ' +
      'A deleted volume cannot be recovered: Docker objects never go to the Recycle Bin.',
    severity: 'danger'
  }
];

export function isDockerPruneKind(value: unknown): value is DockerPruneKind {
  return typeof value === 'string' && (DOCKER_PRUNE_KINDS as readonly string[]).includes(value);
}

/** Rows of `docker system df --format "{{json .}}"`. Unreadable lines are skipped. */
export function parseDockerDf(stdout: string): DockerTypeUsage[] {
  return stdout.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try {
      const r = JSON.parse(line) as Record<string, string>;
      if (!r.Type) return [];
      const pruneKind = PRUNE_KIND_BY_TYPE[r.Type];
      return [{
        type: r.Type,
        count: parseInt(r.TotalCount, 10) || 0,
        active: parseInt(r.Active, 10) || 0,
        sizeBytes: parseDockerSize(r.Size ?? ''),
        reclaimableBytes: parseDockerSize(r.Reclaimable ?? ''),
        ...(pruneKind ? { pruneKind } : {})
      }];
    } catch {
      return [];
    }
  });
}

async function findDisk(candidates: string[]): Promise<{ path: string; size: number; mtimeMs: number } | null> {
  for (const p of candidates) {
    try {
      const st = await fs.promises.stat(p);
      if (st.isFile()) return { path: p, size: st.size, mtimeMs: st.mtimeMs };
    } catch { /* try the next layout */ }
  }
  return null;
}

async function virtualDisk(candidates: string[], liveStored: number | null): Promise<DockerVirtualDisk | null> {
  const disk = await findDisk(candidates);
  if (!disk) return null;
  // Docker stopped: fall back to the remembered reading, valid only while the file is unchanged.
  const stored = liveStored ?? await dockerStoredBytes(disk.mtimeMs);
  return {
    path: disk.path,
    sizeBytes: disk.size,
    trappedBytes: stored === null ? null : Math.max(0, disk.size - stored),
    compactCommand: compactCommandFor(disk.path)
  };
}

/** Per-type Docker usage plus the virtual disk. Never throws: failures become a state. */
export async function getDockerBreakdown(
  deps: { exec?: Exec; diskCandidates?: string[] } = {}
): Promise<DockerBreakdown> {
  const exec = deps.exec ?? defaultExec;
  const candidates = deps.diskCandidates ?? DOCKER_DISKS;
  const base = { types: [] as DockerTypeUsage[], manual: DOCKER_MANUAL_CLEANUPS };

  try {
    const { stdout } = await exec('docker', ['system', 'df', '--format', '{{json .}}'], 20_000);
    const types = parseDockerDf(stdout);
    const stored = types.length ? types.reduce((sum, t) => sum + t.sizeBytes, 0) : null;
    return { ...base, state: 'ok', types, disk: await virtualDisk(candidates, stored) };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const disk = await virtualDisk(candidates, null).catch(() => null);
    if (err.code === 'ENOENT') {
      return { ...base, state: 'not-installed', message: 'Docker is not installed (the docker command was not found).', disk };
    }
    return {
      ...base,
      state: 'not-running',
      message: 'Docker is installed but not answering. Start Docker Desktop and refresh to see what is inside it.',
      disk
    };
  }
}

/** Runs one of the two allowed prunes. Anything else is refused, never passed to Docker. */
export async function pruneDocker(kind: unknown, exec: Exec = defaultExec): Promise<DockerPruneResult> {
  if (!isDockerPruneKind(kind)) return { ok: false, reclaimed: null, output: 'Not an allowed Docker cleanup.' };
  try {
    const { stdout, stderr } = await exec('docker', PRUNE_ARGS[kind], 10 * 60_000);
    const output = (stdout + stderr).trim();
    // image prune: "Total reclaimed space: 1.2GB"; builder prune: "Total:\t1.2GB".
    const reclaimed = /Total(?: reclaimed space)?:\s*(\S+)/i.exec(output)?.[1] ?? null;
    return { ok: true, reclaimed, output: output || 'Done.' };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string; code?: string };
    const output = err.code === 'ENOENT'
      ? 'Docker is not installed.'
      : ((err.stdout ?? '') + (err.stderr ?? '')).trim() || err.message;
    return { ok: false, reclaimed: null, output };
  }
}

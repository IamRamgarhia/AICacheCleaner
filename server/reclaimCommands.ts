import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Tool-native cleanup commands.
 *
 * Some space cannot be reclaimed by deleting a folder. Docker keeps everything
 * inside a single 55 GB virtual disk; deleting that file destroys every image,
 * container and volume, and `docker system prune` frees the space *inside* it
 * without shrinking the file at all. The same is true of package managers that
 * own their cache format.
 *
 * So these are commands, not paths. Every one is defined HERE, server-side, and
 * selected by id — the client sends an id, never a command string. That is the
 * trust boundary: this endpoint runs programs, so nothing a caller types may
 * reach an executable position.
 */
export interface ReclaimCommand {
  id: string;
  tool: string;
  label: string;
  /** Read-only: shows what would be freed. Safe to run any time. */
  preview: { bin: string; args: string[] };
  /** The actual cleanup. */
  run: { bin: string; args: string[] };
  /** Copy-pasteable form, for users who would rather run it themselves. */
  manual: string;
  note: string;
  /** True when the tool must be running for the command to work. */
  needsDaemon?: boolean;
}

export const RECLAIM_COMMANDS: ReclaimCommand[] = [
  {
    id: 'docker-prune',
    tool: 'Docker',
    label: 'Unused images, stopped containers, build cache',
    preview: { bin: 'docker', args: ['system', 'df'] },
    // Deliberately NOT --volumes. Named volumes hold databases and app state;
    // wiping them is data loss, not cleanup. Volumes are mentioned in the note
    // so the user can opt in manually if they mean it.
    run: { bin: 'docker', args: ['system', 'prune', '-a', '-f'] },
    manual: 'docker system prune -a',
    note:
      'Removes images not used by a container, stopped containers and the build cache. ' +
      'Named volumes are NOT touched — add --volumes yourself if you also want those gone (that deletes database data). ' +
      'Docker Desktop must be running.',
    needsDaemon: true
  },
  {
    id: 'docker-compact',
    tool: 'Docker',
    label: 'Shrink the virtual disk after pruning',
    preview: { bin: 'wsl', args: ['--list', '--verbose'] },
    run: { bin: 'wsl', args: ['--manage', 'docker-desktop', '--set-sparse', 'true'] },
    manual: 'wsl --manage docker-desktop --set-sparse true',
    note:
      'Pruning frees space INSIDE the virtual disk but the .vhdx file on your drive stays the same size. ' +
      'This marks it sparse so Windows can reclaim the freed blocks. Run it after a prune, with Docker stopped.',
    needsDaemon: false
  },
  {
    id: 'npm-cache-clean',
    tool: 'npm',
    label: 'npm download cache',
    preview: { bin: 'npm', args: ['cache', 'verify'] },
    run: { bin: 'npm', args: ['cache', 'clean', '--force'] },
    manual: 'npm cache clean --force',
    note: 'Packages are refetched on the next install. Installed node_modules are untouched.'
  },
  {
    id: 'pip-cache-purge',
    tool: 'pip',
    label: 'pip wheel cache',
    preview: { bin: 'pip', args: ['cache', 'info'] },
    run: { bin: 'pip', args: ['cache', 'purge'] },
    manual: 'pip cache purge',
    note: 'Wheels are refetched on demand. Installed packages are untouched.'
  },
  {
    id: 'uv-cache-clean',
    tool: 'uv',
    label: 'uv Python cache',
    preview: { bin: 'uv', args: ['cache', 'dir'] },
    run: { bin: 'uv', args: ['cache', 'clean'] },
    manual: 'uv cache clean',
    note: 'Refetched on demand.'
  },
  {
    id: 'yarn-cache-clean',
    tool: 'Yarn',
    label: 'Yarn download cache',
    preview: { bin: 'yarn', args: ['cache', 'dir'] },
    run: { bin: 'yarn', args: ['cache', 'clean'] },
    manual: 'yarn cache clean',
    note: 'Refetched on demand.'
  },
  {
    id: 'go-cache-clean',
    tool: 'Go',
    label: 'Go build and module cache',
    preview: { bin: 'go', args: ['env', 'GOMODCACHE'] },
    run: { bin: 'go', args: ['clean', '-cache', '-modcache'] },
    manual: 'go clean -cache -modcache',
    note: 'Modules are redownloaded on the next build.'
  },
  {
    id: 'gradle-cache-clean',
    tool: 'Gradle',
    label: 'Gradle daemon and build cache',
    preview: { bin: 'gradle', args: ['--status'] },
    run: { bin: 'gradle', args: ['--stop'] },
    manual: 'gradle --stop   # then delete ~/.gradle/caches',
    note: 'Stops daemons holding memory. The cache folder itself is listed separately and can be deleted directly.'
  }
];

/** Is the tool on PATH at all? */
async function isAvailable(bin: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [bin], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function listAvailableReclaimCommands() {
  return Promise.all(
    RECLAIM_COMMANDS.map(async c => ({
      id: c.id,
      tool: c.tool,
      label: c.label,
      manual: c.manual,
      note: c.note,
      available: await isAvailable(c.run.bin)
    }))
  );
}

/**
 * Run a command by id. `mode` picks the read-only preview or the real cleanup.
 * Nothing from the caller is interpolated into the command.
 */
export async function runReclaimCommand(
  id: string,
  mode: 'preview' | 'run'
): Promise<{ ok: boolean; output: string; command: string }> {
  const cmd = RECLAIM_COMMANDS.find(c => c.id === id);
  if (!cmd) return { ok: false, output: `Unknown command: ${id}`, command: '' };

  const spec = mode === 'preview' ? cmd.preview : cmd.run;
  const display = `${spec.bin} ${spec.args.join(' ')}`;

  if (!(await isAvailable(spec.bin))) {
    return { ok: false, output: `${spec.bin} is not installed or not on PATH.`, command: display };
  }

  try {
    const { stdout, stderr } = await execFileAsync(spec.bin, spec.args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: mode === 'preview' ? 30_000 : 10 * 60_000
    });
    return { ok: true, output: (stdout + stderr).trim() || 'Done.', command: display };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: (err.stdout || '') + (err.stderr || '') || err.message,
      command: display
    };
  }
}

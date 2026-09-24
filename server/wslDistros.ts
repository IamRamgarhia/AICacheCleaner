import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { WslDistro, WslListing } from '../src/lib/types/dockerWsl';

const execFileAsync = promisify(execFile);

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';

/**
 * Copy-paste compaction for one virtual disk. Shown, never run: it needs an
 * elevated shell and every WSL distro stopped.
 */
export function compactCommandFor(vhdxPath: string): string | null {
  // The path comes from a user-writable registry key and is pasted into an
  // ADMIN shell. PowerShell treats ' and the typographic quotes U+2018–U+201B
  // alike as single-quote delimiters; each is escaped by doubling. Control
  // characters have no business in a path: no command at all then.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f"]/.test(vhdxPath)) return null;
  const quoted = vhdxPath.replace(/['‘-‛]/g, m => m + m);
  return 'wsl --shutdown; ' +
    `Set-Content "$env:TEMP\\compact-vhdx.txt" 'select vdisk file="${quoted}"','attach vdisk readonly','compact vdisk','detach vdisk'; ` +
    'diskpart /s "$env:TEMP\\compact-vhdx.txt"';
}

export const WSL_COMPACT_STEPS = [
  'A WSL disk file grows as Linux writes data and never shrinks by itself, even after you delete files inside the distro.',
  'Save your work, close every Linux terminal and quit Docker Desktop if it is running.',
  'Open PowerShell as administrator and run "wsl --shutdown" (this stops ALL distros).',
  'Windows Pro/Enterprise with Hyper-V: Optimize-VHD -Path "<disk path>" -Mode Full',
  'Any edition: paste the diskpart command shown for that distro. It only releases empty blocks — your files stay.',
  'Never delete an ext4.vhdx file: it IS that distro, with everything inside it.'
];

type RawDistro = Omit<WslDistro, 'sizeBytes'>;
type Section = { id: string | null; values: Record<string, string> };

/** Parse `reg query <Lxss> /s` output. Pure, so it is testable without WSL. */
export function parseLxss(stdout: string): RawDistro[] {
  const sections: Section[] = stdout.split(/\r?\n(?=HKEY_)/).map(section => {
    const [header, ...lines] = section.split(/\r?\n/);
    const values = Object.fromEntries(lines
      .map(l => /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => [m[1], m[2].trim()]));
    return { id: /\\(\{[^}]+\})\s*$/.exec(header)?.[1] ?? null, values };
  });
  const defaultId = sections.find(s => s.id === null && s.values.DefaultDistribution)?.values.DefaultDistribution.toLowerCase();

  return sections
    .filter((s): s is Section & { id: string } => s.id !== null && Boolean(s.values.DistributionName && s.values.BasePath))
    .map(({ id, values }) => {
      const name = values.DistributionName;
      const basePath = values.BasePath.replace(/^\\\\\?\\/, '');
      const version = parseInt(values.Version ?? '0x2', 16) === 1 ? 1 : 2;
      const vhdxPath = version === 2 ? path.win32.join(basePath, values.VhdFileName || 'ext4.vhdx') : null;
      return {
        id,
        name,
        version,
        isDefault: defaultId === id.toLowerCase(),
        basePath,
        vhdxPath,
        managedByDocker: name.toLowerCase().startsWith('docker-desktop'),
        compactCommand: vhdxPath ? compactCommandFor(vhdxPath) : null
      };
    });
}

async function sizeOf(file: string | null): Promise<number | null> {
  if (!file) return null;
  try {
    return (await fs.promises.stat(file)).size;
  } catch {
    return null;
  }
}

/** Installed WSL distros with their disk sizes (stat only). [] off Windows or without WSL. */
export async function listWslDistros(): Promise<WslDistro[]> {
  if (process.platform !== 'win32') return [];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('reg', ['query', LXSS_KEY, '/s'], { windowsHide: true, timeout: 10_000 }));
  } catch {
    return []; // key absent: WSL was never set up
  }
  return Promise.all(parseLxss(stdout).map(async d => ({ ...d, sizeBytes: await sizeOf(d.vhdxPath) })));
}

export async function getWslListing(): Promise<WslListing> {
  return { distros: await listWslDistros(), compactSteps: WSL_COMPACT_STEPS };
}

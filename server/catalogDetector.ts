import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import type { AISoftwareAppItem, SoftwareChild } from '../src/types';
import { formatBytes, measureDirectory } from './scanner';
import { mapLimit, pathExists } from './fsAsync';
import { CATALOG, type CatalogEntry } from './aiCatalog';
import type { InstalledProgram } from './installedPrograms';
import type { LightProcess } from './processList';

const home = os.homedir();
const systemRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
// Folders many programs share: measuring one as "Node.js" or "Git" would
// count every other tool in it (and the dedupe below would then hide them).
const TOO_BROAD = new Set(
  [home, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA, process.env.APPDATA, path.join(home, 'AppData'),
    '/usr', '/usr/bin', '/usr/local', '/usr/local/bin', '/opt/homebrew', '/opt/homebrew/bin', '/bin', '/opt',
    path.join(home, '.local'), path.join(home, '.local', 'bin'), path.join(home, 'bin'),
    path.join(home, 'scoop', 'shims'), path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin')]
    .filter((p): p is string => !!p)
    .map(p => path.resolve(p).toLowerCase())
);

/** A folder we can honestly call "this app's install": not System32, not Program Files itself. */
export function isOwnFolder(dir: string): boolean {
  const resolved = path.resolve(dir).toLowerCase();
  // Driver and MSI packages point at their installer copy, not the install.
  if (resolved.startsWith(systemRoot) || TOO_BROAD.has(resolved) || /[\\/]installer\d*[\\/]/.test(resolved)) return false;
  return resolved.split(/[\\/]/).filter(Boolean).length >= 2;
}

/** First existing executable, searching PATH then the entry's known folders. */
async function locate(entry: CatalogEntry): Promise<string | null> {
  if (!entry.exe) return null;
  const dirs = [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...(entry.knownDirs ?? [])];
  for (const dir of dirs) {
    // WindowsApps holds "App Execution Alias" stubs (python.exe opens the Store);
    // System32 holds launchers like wsl.exe. Neither is the install.
    if (/[\\/]WindowsApps$/i.test(dir) || dir.toLowerCase().startsWith(systemRoot)) continue;
    for (const name of entry.exe) {
      const candidate = path.join(dir, name);
      // Follow symlinks (/usr/local/bin/node → the real install) so the root
      // is the tool's own folder, not the shared bin it's linked from.
      if (await pathExists(candidate)) return fsp.realpath(candidate).catch(() => candidate);
    }
  }
  return null;
}

/** Drop duplicates and folders nested inside another listed folder. */
export function outermost(dirs: string[]): string[] {
  const unique = [...new Map(dirs.map(d => [path.resolve(d).toLowerCase(), path.resolve(d)])).values()];
  return unique.filter(d => !unique.some(o => o !== d && d.toLowerCase().startsWith(o.toLowerCase() + path.sep)));
}

interface Found { entry: CatalogEntry; programs: InstalledProgram[]; exe: string | null; roots: string[] }

async function find(entry: CatalogEntry, programs: InstalledProgram[]): Promise<Found | null> {
  const matched = entry.program ? programs.filter(p => entry.program!.test(p.name)) : [];
  const picked = entry.aggregate ? matched : matched.slice(0, 1);
  const exe = await locate(entry);
  if (picked.length === 0 && !exe) return null;

  const fromPrograms = picked.flatMap(p => {
    if (p.installLocation) return [p.installLocation];
    return p.iconPath ? [path.dirname(p.iconPath)] : [];
  });
  const fromExe = exe ? [entry.rootFrom ? entry.rootFrom(exe) : path.dirname(exe)] : [];
  const roots = outermost([...fromPrograms, ...(fromPrograms.length ? [] : fromExe)].filter(isOwnFolder));
  return { entry, programs: picked, exe, roots };
}

export async function detectCatalogSoftware(programs: InstalledProgram[], processes: LightProcess[]): Promise<AISoftwareAppItem[]> {
  const found = (await mapLimit(CATALOG, 6, e => find(e, programs))).filter((f): f is Found => f !== null);

  // A shim inside another tool's folder (pnpm.cmd in Node.js) would count
  // that folder twice — keep the first tool for each install folder.
  const seen = new Set<string>();
  const unique = found.filter(f => {
    const key = f.roots[0]?.toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return mapLimit(unique, 4, async ({ entry, programs: matched, exe, roots }) => {
    const dataDirs = [];
    for (const d of entry.dataDirs ?? []) if (await pathExists(d)) dataDirs.push(d);
    const paths = outermost([...roots, ...dataDirs]);
    const measured = await Promise.all(paths.map(async p => (await measureDirectory(p)).bytes));
    // Programs without a known folder still report their size to Windows.
    const unlocated = matched.filter(p => !p.installLocation && !p.iconPath).reduce((a, p) => a + (p.estimatedBytes ?? 0), 0);
    const bytes = measured.reduce((a, b) => a + b, 0) + (roots.length === 0 ? unlocated : 0);

    const procs = entry.running ? processes.filter(p => entry.running!.test(p.name)) : [];
    const children: SoftwareChild[] | undefined = entry.aggregate && matched.length > 1
      ? matched.map(p => ({ name: p.name, detail: p.version, sizeBytes: p.estimatedBytes, path: p.installLocation }))
      : undefined;
    const version = matched[0]?.version;

    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      group: entry.group,
      publisher: matched[0]?.publisher,
      version: version ? (children ? `${matched.length} versions` : `v${version.replace(/^v/i, '')}`) : undefined,
      status: procs.length > 0 ? 'ACTIVE IN RAM' : 'INSTALLED ON DISK',
      detectionPaths: paths,
      executableName: exe ? path.basename(exe) : undefined,
      iconPath: matched.find(p => p.iconPath)?.iconPath ?? (exe && /\.exe$/i.test(exe) ? exe : undefined),
      ramMb: procs.length > 0 ? procs.reduce((a, p) => a + p.memoryMb, 0) : undefined,
      processCount: procs.length || undefined,
      totalDiskSizeBytes: bytes,
      formattedDiskSize: formatBytes(bytes),
      description: entry.usedFor,
      children,
      // AI apps use the normal clean / uninstall flow; everything else is
      // shown for information only — other tools break without it.
      canUninstall: entry.group === 'ai'
    } satisfies AISoftwareAppItem;
  });
}

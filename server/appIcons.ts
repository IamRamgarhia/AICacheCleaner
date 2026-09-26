import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { AISoftwareAppItem } from '../src/types';
import { pathExists, readdirSafe } from './fsAsync';

const execFileAsync = promisify(execFile);

/**
 * Each app's real icon, taken from its .exe on the engine side so it shows in
 * the desktop window and in a plain browser alike. All icons come from ONE
 * PowerShell call (every launch is slow in an unsigned app) and are kept for
 * the life of the engine.
 */
const cache = new Map<string, string | null>();

// Paths travel in the environment (never the command text) as UTF-16 base64.
const PS_ICONS = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  "$ErrorActionPreference='SilentlyContinue'",
  'Add-Type -AssemblyName System.Drawing',
  '$paths = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:AICC_ICON_PATHS)) -split "`n"',
  '$out = @{}',
  'foreach ($p in $paths) { try {',
  '  $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($p); $bmp = $ico.ToBitmap(); $ms = New-Object IO.MemoryStream',
  '  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $out[$p] = [Convert]::ToBase64String($ms.ToArray())',
  '  $bmp.Dispose(); $ico.Dispose(); $ms.Dispose() } catch {} }',
  '$out | ConvertTo-Json -Compress'
].join('\n');

async function extract(paths: string[]): Promise<void> {
  const todo = [...new Set(paths)].filter(p => !cache.has(p));
  if (todo.length === 0 || process.platform !== 'win32') return;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_ICONS], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, AICC_ICON_PATHS: Buffer.from(todo.join('\n'), 'utf16le').toString('base64') }
    });
    const found = JSON.parse(stdout || '{}') as Record<string, string>;
    for (const p of todo) cache.set(p, typeof found[p] === 'string' ? `data:image/png;base64,${found[p]}` : null);
  } catch {
    // Icons are decoration; the list falls back to logos and initials.
  }
}

/** Local .exe paths only — never a network share, which would send credentials to that host. */
const isLocalExe = (p: string) => /\.exe$/i.test(p) && path.isAbsolute(p) && !/^[\\/]{2}/.test(p);

/** The app's executable inside one of its folders (top level, or one level down like app-1.2.3\). */
async function findExe(dirs: string[], exeName: string): Promise<string | undefined> {
  for (const d of dirs) {
    const direct = path.join(d, exeName);
    if (await pathExists(direct)) return direct;
    for (const e of await readdirSafe(d)) {
      if (!e.isDirectory()) continue;
      const nested = path.join(d, e.name, exeName);
      if (await pathExists(nested)) return nested;
    }
  }
  return undefined;
}

/** Adds `iconDataUrl` to every item whose executable we can find. */
export async function withAppIcons(items: AISoftwareAppItem[]): Promise<AISoftwareAppItem[]> {
  const withExe = await Promise.all(items.map(async item => {
    const exe = item.iconPath ?? (item.executableName ? await findExe(item.detectionPaths, item.executableName) : undefined);
    return { item, exe: exe && isLocalExe(exe) ? exe : undefined };
  }));
  await extract(withExe.flatMap(x => (x.exe ? [x.exe] : [])));
  return withExe.map(({ item, exe }) => {
    const url = exe ? cache.get(exe) : null;
    return url ? { ...item, iconPath: exe, iconDataUrl: url } : item;
  });
}

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface InstalledProgram {
  name: string;
  version?: string;
  publisher?: string;
  installLocation?: string;
  /** Executable the uninstaller shows as the app icon — usually the app itself. */
  iconPath?: string;
  estimatedBytes?: number;
}

// Every program Windows lists under Settings > Apps, from the three Uninstall
// keys, in one PowerShell call. Hidden system components and updates
// (SystemComponent / ParentKeyName) are left out, as Settings does.
// UTF-8 out, or non-ASCII paths (C:\Users\José) arrive garbled.
const PS_PROGRAMS = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'
$keys = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
@(Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | ForEach-Object {
  [pscustomobject]@{ n=[string]$_.DisplayName; v=[string]$_.DisplayVersion; p=[string]$_.Publisher; l=[string]$_.InstallLocation; i=[string]$_.DisplayIcon; s=[int64]$_.EstimatedSize }
}) | ConvertTo-Json -Compress`;

/** "C:\x\app.exe",0 → C:\x\app.exe ; .ico and installer copies (Installer, Package Cache) are dropped. */
export function cleanIconPath(raw: string): string | undefined {
  const p = raw.trim().replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '').trim();
  // A network path (\\host\share) would make us contact that host — and send the
  // user's Windows credentials — just to draw an icon.
  if (/^[\\/]{2}/.test(p)) return undefined;
  return /\.exe$/i.test(p) && !/\\(Installer|Package Cache)\\/i.test(p) ? p : undefined;
}

export function parsePrograms(stdout: string): InstalledProgram[] {
  const parsed = JSON.parse(stdout || '[]');
  const rows: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set<string>();
  return rows.flatMap(r => {
    const name = String(r.n ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    const loc = String(r.l ?? '').trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
    const size = Number(r.s) || 0;
    return [{
      name,
      // "Python 3.14.7 (64-bit)" reports 3.14.7150.0; the name carries the real one.
      version: name.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? (String(r.v ?? '').trim() || undefined),
      publisher: String(r.p ?? '').trim() || undefined,
      // Some installers write placeholders like [HP_PRINTSCAN_DIR].
      installLocation: loc && !loc.startsWith('[') ? loc : undefined,
      iconPath: cleanIconPath(String(r.i ?? '')),
      estimatedBytes: size > 0 ? size * 1024 : undefined
    }];
  });
}

let cached: { at: number; list: InstalledProgram[] } | null = null;
const TTL_MS = 10 * 60_000;

/** Installed programs (Windows). Other platforms return an empty list. */
export async function listInstalledPrograms(): Promise<InstalledProgram[]> {
  if (process.platform !== 'win32') return [];
  if (cached && Date.now() - cached.at < TTL_MS) return cached.list;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_PROGRAMS], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024
    });
    cached = { at: Date.now(), list: parsePrograms(stdout) };
    return cached.list;
  } catch {
    return cached?.list ?? [];
  }
}

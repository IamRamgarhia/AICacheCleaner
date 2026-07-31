import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Real restore from the Windows Recycle Bin.
 *
 * "Restore points" previously only checked whether a path happened to exist
 * again and then reported success — the button said "Restore Data to Computer"
 * but nothing was ever moved. Recovery was entirely manual.
 *
 * The Recycle Bin is a shell namespace, not a plain folder, so files cannot be
 * moved back with fs operations. We drive the Windows Shell COM API instead.
 *
 * Locale note: the obvious approach — InvokeVerb('R&estore') — depends on the
 * UI language of the machine and silently does nothing on a non-English
 * Windows. `Namespace(<dir>).MoveHere(<item>)` performs the same move and is
 * locale-independent, so that is what runs below.
 */

export interface RestoreOutcome {
  path: string;
  restored: boolean;
  reason?: string;
}

/** Column 1 of the Recycle Bin view is "Original Location" on Windows 10/11. */
const ORIGINAL_LOCATION_COLUMN = 1;

export function buildRestoreScript(targets: string[], destinationDir?: string): string {
  // Targets are passed as a here-string literal and compared inside PowerShell,
  // so no path is ever interpolated into an executable position.
  const list = targets.map(t => t.replace(/'/g, "''")).map(t => `'${t}'`).join(',');
  const destLiteral = destinationDir ? `'${destinationDir.replace(/'/g, "''")}'` : '$null';

  return `
$ErrorActionPreference = 'Stop'
$targets = @(${list})
$override = ${destLiteral}
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(10)
$results = @()

foreach ($target in $targets) {
  $leaf = Split-Path $target -Leaf
  $parent = Split-Path $target -Parent
  $match = $null

  foreach ($item in $bin.Items()) {
    $origin = $bin.GetDetailsOf($item, ${ORIGINAL_LOCATION_COLUMN})
    if ($item.Name -eq $leaf -and $origin -eq $parent) { $match = $item; break }
  }

  if ($null -eq $match) {
    $results += [pscustomobject]@{ path = $target; restored = $false; reason = 'Not found in the Recycle Bin' }
    continue
  }

  $destDir = if ($override) { $override } else { $parent }
  if (-not (Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }

  try {
    $destNs = $shell.Namespace($destDir)
    if ($null -eq $destNs) { throw "Destination not reachable: $destDir" }
    $destNs.MoveHere($match)
    Start-Sleep -Milliseconds 250
    $landed = Join-Path $destDir $leaf
    if (Test-Path -LiteralPath $landed) {
      $results += [pscustomobject]@{ path = $landed; restored = $true; reason = $null }
    } else {
      $results += [pscustomobject]@{ path = $target; restored = $false; reason = 'Shell reported no error but the item did not appear' }
    }
  } catch {
    $results += [pscustomobject]@{ path = $target; restored = $false; reason = $_.Exception.Message }
  }
}

$results | ConvertTo-Json -Compress -Depth 3
`;
}

/**
 * Move the given original paths back out of the Recycle Bin.
 * Returns one outcome per requested path — never throws for a single failure.
 */
export async function restoreFromRecycleBin(
  targets: string[],
  destinationDir?: string
): Promise<RestoreOutcome[]> {
  if (targets.length === 0) return [];

  if (os.platform() !== 'win32') {
    return targets.map(p => ({
      path: p,
      restored: false,
      reason: 'Automatic restore is currently implemented for Windows only'
    }));
  }

  const script = buildRestoreScript(targets.map(t => path.normalize(t)), destinationDir);

  // -EncodedCommand (UTF-16LE base64) rather than -Command: passing a script
  // through -Command goes via CommandLineToArgvW, which ate the backslashes in
  // Windows paths ("D:\folder" arrived as "D:folder") and every lookup missed.
  // Encoding sidesteps all shell quoting.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true }
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      return targets.map(p => ({ path: p, restored: false, reason: 'No response from the Windows Shell' }));
    }

    const parsed = JSON.parse(trimmed);
    const rows: RestoreOutcome[] = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(r => ({ path: r.path, restored: !!r.restored, reason: r.reason || undefined }));
  } catch (e) {
    return targets.map(p => ({ path: p, restored: false, reason: (e as Error).message }));
  }
}

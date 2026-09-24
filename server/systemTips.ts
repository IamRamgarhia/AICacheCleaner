import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { formatBytes, measureDirectory } from './scanner';
import { mapLimit, readdirSafe, statSafe } from './fsAsync';

/**
 * Windows space that this app must NOT touch itself, only report.
 *
 * Every item here is either owned by Windows (hibernation, update staging),
 * owned by a vendor tool (NVIDIA), or is the user's own data (Downloads,
 * Recycle Bin). Deleting any of it from here would either break a feature or
 * destroy something the user may want, so the module only measures and hands
 * back plain-language steps. Nothing is deleted, moved or modified, and the
 * `commands` are copy-paste text — never executed by the app.
 */
export interface SystemTip {
  id: string;
  title: string;
  /** Measured now; 0 if unknown. Tips with 0 bytes are never returned. */
  bytes: number;
  formattedSize: string;
  /** What it is and what removing it costs. */
  why: string;
  steps: string[];
  /** Copy-paste only. Never executed by the app. */
  commands?: { label: string; command: string; needsAdmin: boolean }[];
  /** Folder to reveal in Explorer. */
  openPath?: string;
  /** medium = the user loses a feature (e.g. hibernate). */
  risk: 'low' | 'medium';
}

export interface TipEnv {
  systemDrive: string;
  systemRoot: string;
  home: string;
  programData: string;
  localAppData: string;
  now: number;
  /** Drive roots whose Recycle Bin is measured. Defaults to [systemDrive]. */
  drives?: string[];
}

const execFileAsync = promisify(execFile);
const DAY_MS = 86_400_000;
const OLD_DOWNLOAD_DAYS = 90;
// Tips measure in parallel, and each measureDirectory call is itself bounded,
// so keep this small to stay well under the fd limit.
const TIP_CONCURRENCY = 3;
const PATH_CONCURRENCY = 4;

export function defaultTipEnv(): TipEnv {
  const home = os.homedir();
  const systemDrive = process.env.SystemDrive || 'C:';
  // ponytail: probes every letter C..Z; a disconnected mapped network drive can
  // make its stat slow. Filter by drive type (needs WMI) if that becomes a problem.
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:`);
  return {
    systemDrive,
    systemRoot: process.env.SystemRoot || path.join(driveRoot(systemDrive), 'Windows'),
    home,
    programData: process.env.ProgramData || path.join(driveRoot(systemDrive), 'ProgramData'),
    localAppData: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    now: Date.now(),
    drives: letters
  };
}

/** `C:` -> `C:\`. `path.join('C:', 'x')` would give the drive-RELATIVE `C:x`. */
function driveRoot(drive: string): string {
  return /^[A-Za-z]:$/.test(drive) ? `${drive}\\` : drive;
}

function makeTip(base: Omit<SystemTip, 'formattedSize'>): SystemTip {
  return { ...base, formattedSize: formatBytes(base.bytes) };
}

async function totalBytes(paths: string[]): Promise<number> {
  const sizes = await mapLimit(paths, PATH_CONCURRENCY, async (p) => (await measureDirectory(p)).bytes);
  return sizes.reduce((sum, n) => sum + n, 0);
}

/**
 * Size of a file Windows holds locked, e.g. the live hiberfil.sys.
 *
 * fs.stat opens a handle and gets EPERM on it, but the directory listing still
 * carries the size, so read it from `dir` (`/-c` = plain digits, no locale
 * separators). Read-only. Only runs for a real `X:` drive root and a file the
 * listing actually contains, so nothing unexpected ever reaches cmd.
 */
export async function lockedRootFileSize(drive: string, name: string): Promise<number> {
  if (!/^[A-Za-z]:$/.test(drive)) return 0;
  const listed = (await readdirSafe(driveRoot(drive))).some((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!listed) return 0;
  try {
    const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', 'dir', '/a', '/-c', path.join(driveRoot(drive), name)], {
      windowsHide: true,
      timeout: 10_000
    });
    return parseDirSize(stdout, name);
  } catch {
    return 0;
  }
}

/** Byte count from a `dir /-c` listing line ending in `name`; 0 if absent. */
export function parseDirSize(listing: string, name: string): number {
  // `name` is always a fixed constant like hiberfil.sys; only the dot needs escaping.
  const match = listing.match(new RegExp(`(\\d+)\\s+${name.replace(/\./g, '\\.')}\\s*$`, 'im'));
  return match ? Number(match[1]) : 0;
}

// Hibernation file.
// https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options
//   "/type reduced | full ... A reduced hiberfile only supports hiberboot" (hiberboot = Fast Startup);
//   a custom size must be reset with `/size 0` before the type can change to reduced.
// https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/disable-and-re-enable-hibernation
//   `powercfg.exe /hibernate off` from an elevated prompt; hybrid sleep stops working, and
//   Microsoft warns data can be lost on power loss if hybrid sleep was on.
async function hibernationTip(env: TipEnv): Promise<SystemTip | null> {
  const file = path.join(driveRoot(env.systemDrive), 'hiberfil.sys');
  const bytes = (await statSafe(file))?.size ?? (await lockedRootFileSize(env.systemDrive, 'hiberfil.sys'));
  if (!bytes) return null;
  return makeTip({
    id: 'hibernation-file',
    title: 'Hibernation file',
    bytes,
    why:
      'Windows keeps this file so the PC can hibernate and start quickly (Fast Startup). ' +
      'Making it smaller keeps Fast Startup but removes the Hibernate option; turning it off also disables Fast Startup and hybrid sleep.',
    steps: [
      'Save your work.',
      'Open Start, type "cmd", right-click Command Prompt and choose "Run as administrator".',
      'To shrink the file but keep Fast Startup, paste the first command. If Windows refuses, run "powercfg /h /size 0" first, then try again.',
      'Only if you never use Hibernate or Fast Startup, paste the second command instead. You can undo it later with "powercfg /h on".'
    ],
    commands: [
      { label: 'Smaller file, keep Fast Startup (removes Hibernate)', command: 'powercfg /h /type reduced', needsAdmin: true },
      { label: 'Turn off hibernation and Fast Startup', command: 'powercfg /h off', needsAdmin: true }
    ],
    risk: 'medium'
  });
}

// Windows Update leftovers.
// https://support.microsoft.com/en-us/windows/free-up-drive-space-in-windows-85529ccb-c365-490d-b548-831022bc9b32
//   Disk Cleanup -> "Clean up system files"; Settings > System > Storage > Cleanup recommendations / Temporary files.
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cleanmgr
//   `cleanmgr` opens Disk Cleanup.
// $WinREAgent is Windows' staging folder for recovery-environment updates. Microsoft
// has no page telling users to remove it by hand, so we never suggest that.
async function updateLeftoversTip(env: TipEnv): Promise<SystemTip | null> {
  const paths = [
    path.join(driveRoot(env.systemDrive), '$WinREAgent'),
    path.join(env.systemRoot, 'SoftwareDistribution', 'Download')
  ];
  return makeTip({
    id: 'windows-update-leftovers',
    title: 'Windows Update leftovers',
    bytes: await totalBytes(paths),
    why:
      'Files Windows downloaded or staged while installing updates. Once updates are finished they are usually not needed, ' +
      "but Windows must remove them itself — deleting these folders by hand can break a pending update or its rollback.",
    steps: [
      'Make sure Windows Update has finished and restart if it asks you to.',
      `Open Start, type "Disk Cleanup", open it and pick drive ${env.systemDrive}.`,
      'Click "Clean up system files" and approve the admin prompt.',
      'Tick "Windows Update Cleanup" and "Temporary files" (if listed), then click OK.',
      'Alternative: Settings > System > Storage > Temporary files, tick the same items, then "Remove files".',
      'Do not delete these folders yourself. If Disk Cleanup leaves some behind, leave them for Windows to manage.'
    ],
    commands: [{ label: 'Open Disk Cleanup', command: 'cleanmgr', needsAdmin: false }],
    risk: 'low'
  });
}

// NVIDIA driver downloads.
// NVIDIA publishes no guidance for NVIDIA App's `UpdateFramework\ota-artifacts` and the
// app has no documented "remove old drivers" option (checked 2026-09). The closest
// official note is about the legacy installer cache, which NVIDIA says is safe to delete
// without affecting the installed driver:
// https://nvidia.custhelp.com/app/answers/detail/a_id/3333/~/disk-space-used-when-installing-nvidia-drivers
// Observed layout: ota-artifacts\grd|crd\<hash>\<version>-...exe, one driver installer per folder.
async function nvidiaTip(env: TipEnv): Promise<SystemTip | null> {
  const base = path.join(env.programData, 'NVIDIA Corporation');
  const ota = path.join(base, 'NVIDIA App', 'UpdateFramework', 'ota-artifacts');
  const legacy = path.join(base, 'Downloader');
  const [otaBytes, legacyBytes] = await mapLimit([ota, legacy], 2, async (p) => (await measureDirectory(p)).bytes);
  return makeTip({
    id: 'nvidia-driver-downloads',
    title: 'NVIDIA driver downloads',
    bytes: otaBytes + legacyBytes,
    why:
      'Driver installers the NVIDIA App (or older GeForce Experience) downloaded. The installed driver does not run from here. ' +
      'NVIDIA has not published an official way to clean this folder, so only old installers should be removed, and only by you.',
    steps: [
      'Open NVIDIA App > Drivers and note the version you have installed.',
      'Open this folder. In "grd" (Game Ready) and "crd" (Studio), each sub-folder holds one driver installer whose file name starts with its version.',
      'Keep the sub-folder whose installer matches your installed version.',
      'You may remove sub-folders holding OLDER versions if you need the space. NVIDIA App downloads again whatever it needs.',
      'Leave everything else (including "nvapp" and "post-processing") alone.'
    ],
    openPath: otaBytes >= legacyBytes ? ota : legacy,
    risk: 'low'
  });
}

/** Old enough to review: newest content older than the cut-off. Empty folders (0) are ignored. */
export function isOldDownload(newestMtimeMs: number, now: number): boolean {
  return newestMtimeMs > 0 && now - newestMtimeMs > OLD_DOWNLOAD_DAYS * DAY_MS;
}

async function oldDownloadsTip(env: TipEnv): Promise<SystemTip | null> {
  const downloads = path.join(env.home, 'Downloads');
  const entries = (await readdirSafe(downloads)).filter(
    (e) => (e.isFile() || e.isDirectory()) && e.name.toLowerCase() !== 'desktop.ini'
  );
  // measureDirectory returns a file's own size/mtime and a folder's newest file mtime.
  const measured = await mapLimit(entries, PATH_CONCURRENCY, (e) => measureDirectory(path.join(downloads, e.name)));
  const old = measured.filter((m) => isOldDownload(m.newestMtimeMs, env.now));
  const count = old.length;
  return makeTip({
    id: 'old-downloads',
    title: 'Old downloads',
    bytes: old.reduce((sum, m) => sum + m.bytes, 0),
    why:
      `${count} item${count === 1 ? '' : 's'} in your Downloads folder have not changed in over ${OLD_DOWNLOAD_DAYS} days. ` +
      'These are YOUR files, so only you can decide what is safe to remove — review them first.',
    steps: [
      'Open your Downloads folder.',
      'Switch to Details view and click "Date modified" to sort oldest first.',
      'Move anything you want to keep somewhere else, then delete what you no longer need (it goes to the Recycle Bin).'
    ],
    openPath: downloads,
    risk: 'low'
  });
}

/** Deleted-item files (`$R...` content, `$I...` metadata) under one drive's Recycle Bin. */
async function recycleBinBytes(drive: string): Promise<number> {
  const bin = path.join(driveRoot(drive), '$Recycle.Bin');
  const owners = (await readdirSafe(bin)).filter((e) => e.isDirectory()).map((e) => path.join(bin, e.name));
  const perOwner = await mapLimit(owners, PATH_CONCURRENCY, async (dir) => {
    const items = (await readdirSafe(dir))
      .filter((e) => e.name.startsWith('$R') || e.name.startsWith('$I'))
      .map((e) => path.join(dir, e.name));
    return totalBytes(items);
  });
  return perOwner.reduce((sum, n) => sum + n, 0);
}

// Recycle Bin.
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cleanmgr
//   "These files aren't permanently removed until you empty the Recycle Bin" and
//   "A Recycle Bin may appear in more than one drive".
// Other users' bins are access-denied and are simply not counted.
async function recycleBinTip(env: TipEnv): Promise<SystemTip | null> {
  const drives = env.drives ?? [env.systemDrive];
  const sizes = await mapLimit(drives, PATH_CONCURRENCY, recycleBinBytes);
  return makeTip({
    id: 'recycle-bin',
    title: 'Recycle Bin',
    bytes: sizes.reduce((sum, n) => sum + n, 0),
    why:
      'Files you already deleted still take up space until the Recycle Bin is emptied. Emptying it is permanent — they cannot be restored afterwards.',
    steps: [
      'Double-click Recycle Bin on the desktop and check nothing in it is still needed. Restore anything you want back.',
      'Right-click the Recycle Bin icon and choose "Empty Recycle Bin".'
    ],
    risk: 'low'
  });
}

// Delivery Optimization cache.
// https://support.microsoft.com/en-us/help/4041707/windows-10-clear-the-delivery-optimization-cache
//   Disk Cleanup -> tick "Delivery Optimization Files".
// https://learn.microsoft.com/en-us/windows/deployment/do/waas-delivery-optimization-reference
//   Windows already trims this cache itself (default max age three days, max 20% of free space).
// Owned by NETWORK SERVICE, so a normal user usually gets "access denied": the size
// then measures 0 and the tip is omitted rather than guessed.
async function deliveryOptimizationTip(env: TipEnv): Promise<SystemTip | null> {
  const cache = path.join(
    env.systemRoot, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'
  );
  return makeTip({
    id: 'delivery-optimization',
    title: 'Delivery Optimization cache',
    bytes: await totalBytes([cache]),
    why: 'Copies of Windows updates kept so they can be shared with other PCs. Windows downloads them again if needed.',
    steps: [
      `Open Start, type "Disk Cleanup", open it and pick drive ${env.systemDrive}.`,
      'Tick "Delivery Optimization Files" (if it is not listed, click "Clean up system files" first), then click OK.'
    ],
    commands: [{ label: 'Open Disk Cleanup', command: 'cleanmgr', needsAdmin: false }],
    risk: 'low'
  });
}

const TIP_BUILDERS: ((env: TipEnv) => Promise<SystemTip | null>)[] = [
  hibernationTip,
  updateLeftoversTip,
  nvidiaTip,
  oldDownloadsTip,
  recycleBinTip,
  deliveryOptimizationTip
];

/** Report-only. Never throws; returns [] off Windows. */
export async function getSystemTips(env: TipEnv = defaultTipEnv()): Promise<SystemTip[]> {
  if (process.platform !== 'win32') return [];
  const tips = await mapLimit(TIP_BUILDERS, TIP_CONCURRENCY, (build) => build(env).catch(() => null));
  return tips.filter((t): t is SystemTip => t !== null && t.bytes > 0);
}

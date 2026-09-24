import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';

/**
 * Fast folder measurement on Windows.
 *
 * Node has no API that returns a file's size from a directory listing, so its
 * walk stats every file — and on Windows each stat opens the file. On folders
 * of many small files (pnpm store, .gemini) that measured 7x slower than
 * robocopy (70 s vs 8 s). FindFirstFileEx returns size and timestamps with the
 * listing itself.
 *
 * It runs as a few long-lived PowerShell workers with a small C# type compiled
 * once. Protocol: "id<TAB>base64(UTF-16 path)" in, "id<TAB>bytes,newestMs" or
 * "id<TAB>ERR" out. Base64 keeps any character in a path (José, 日本) intact
 * regardless of the console code page; the id means a stray line can never be
 * matched to the wrong folder. Anything that can't be measured answers ERR, so
 * the caller falls back to the Node walk — the helper can cost speed, never
 * correctness. Reparse points (junctions, symlinks) are skipped, like the walk.
 */
const CSHARP = `
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
public static class AiccFastDu {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct FindData {
    public uint Attr;
    public uint CLow; public uint CHigh;
    public uint ALow; public uint AHigh;
    public uint WLow; public uint WHigh;
    public uint SizeHigh; public uint SizeLow;
    public uint R0; public uint R1;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string Alt;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr FindFirstFileExW(string name, int level, out FindData data, int op, IntPtr filter, int flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool FindNextFileW(IntPtr h, out FindData data);
  [DllImport("kernel32.dll")]
  static extern bool FindClose(IntPtr h);

  static string Prefixed(string dir) {
    if (dir.StartsWith("\\\\\\\\?\\\\")) return dir;
    if (dir.StartsWith("\\\\\\\\")) return "\\\\\\\\?\\\\UNC\\\\" + dir.Substring(2);
    return "\\\\\\\\?\\\\" + dir;
  }

  public static string Measure(string root) {
    string full = Path.GetFullPath(root).TrimEnd('\\\\');
    long bytes = 0, newest = 0;
    bool first = true;
    var stack = new Stack<string>();
    stack.Push(full);
    while (stack.Count > 0) {
      string dir = stack.Pop();
      FindData d;
      IntPtr h = FindFirstFileExW(Prefixed(dir) + "\\\\*", 1, out d, 0, IntPtr.Zero, 2);
      if (h == new IntPtr(-1)) {
        // The folder asked about must be readable; unreadable subfolders are
        // skipped exactly like the Node walk skips them.
        if (first) throw new IOException("cannot open " + root);
        continue;
      }
      first = false;
      do {
        if (d.Name == "." || d.Name == "..") continue;
        if ((d.Attr & 0x400) != 0) continue;
        if ((d.Attr & 0x10) != 0) { stack.Push(dir + "\\\\" + d.Name); continue; }
        bytes += ((long)d.SizeHigh << 32) | d.SizeLow;
        long w = ((long)d.WHigh << 32) | d.WLow;
        if (w > newest) newest = w;
      } while (FindNextFileW(h, out d));
      FindClose(h);
    }
    long ms = newest == 0 ? 0 : (newest - 116444736000000000L) / 10000;
    return bytes + "," + ms;
  }
}`;

const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${CSHARP}
'@
[Console]::Out.WriteLine('READY')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Split([char]9, 2)
  try {
    $p = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($parts[1]))
    $r = [AiccFastDu]::Measure($p)
  } catch { $r = 'ERR' }
  [Console]::Out.WriteLine($parts[0] + [char]9 + $r)
}`;

type Result = { bytes: number; newestMtimeMs: number } | null;
type Priority = 'high' | 'low';
interface Job { id: number; dir: string; priority: Priority; resolve: (v: Result) => void }

const READY_TIMEOUT_MS = 30_000;
// A whole drive can take minutes; past this the worker is killed and the Node
// walk takes over for that folder.
const JOB_TIMEOUT_MS = 10 * 60_000;
const POOL_SIZE = 4;
// Low-priority work (details pane, disk explorer) may never occupy every
// worker, so a delete's safety re-measure is never stuck behind it.
const MAX_LOW_BUSY = POOL_SIZE - 1;
const MAX_START_FAILURES = 2;

class Worker {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private ready: Promise<boolean>;
  private jobTimer: ReturnType<typeof setTimeout> | null = null;
  current: Job | null = null;
  dead = false;
  becameReady = false;

  constructor(private onIdle: () => void, private onDeath: (w: Worker) => void) {
    // The script goes in as -EncodedCommand so stdin carries only path data.
    const encoded = Buffer.from(WORKER_SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let markReady: (ok: boolean) => void = () => undefined;
    this.ready = new Promise(r => { markReady = r; });
    const readyTimer = setTimeout(() => { markReady(false); this.kill(); }, READY_TIMEOUT_MS);
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line === 'READY') { clearTimeout(readyTimer); this.becameReady = true; markReady(true); continue; }
        this.finish(line);
      }
    });
    const die = () => {
      if (this.dead) return;
      this.dead = true;
      clearTimeout(readyTimer);
      markReady(false);
      this.settle(null);
      this.onDeath(this);
    };
    this.proc.on('exit', die);
    this.proc.on('error', die);
    // A write to a worker that just exited must not crash the backend.
    this.proc.stdin.on('error', die);
    this.hold(false);
  }

  get busy(): boolean { return this.current !== null; }

  /** An idle worker must not keep Node alive (tests, CLI probes); a busy one must. */
  private hold(on: boolean): void {
    const handles = [this.proc, this.proc.stdout, this.proc.stdin, this.proc.stderr] as unknown as { ref?: () => void; unref?: () => void }[];
    for (const h of handles) (on ? h.ref : h.unref)?.call(h);
  }

  private settle(result: Result): void {
    const job = this.current;
    this.current = null;
    if (this.jobTimer) { clearTimeout(this.jobTimer); this.jobTimer = null; }
    this.hold(false);
    job?.resolve(result);
  }

  async run(job: Job): Promise<void> {
    this.current = job;
    this.hold(true);
    if (!(await this.ready) || this.dead) {
      this.settle(null);
      this.onIdle();
      return;
    }
    this.jobTimer = setTimeout(() => this.kill(), JOB_TIMEOUT_MS);
    const payload = Buffer.from(job.dir, 'utf16le').toString('base64');
    this.proc.stdin.write(`${job.id}\t${payload}\n`);
  }

  private finish(line: string): void {
    const [id, result = ''] = line.split('\t');
    if (!this.current || Number(id) !== this.current.id) return; // not an answer to our request
    const [b, ms] = result.split(',').map(Number);
    this.settle(result === 'ERR' || !Number.isFinite(b) ? null : { bytes: b, newestMtimeMs: ms || 0 });
    this.onIdle();
  }

  kill(): void { try { this.proc.kill(); } catch { /* gone */ } }
}

const workers: Worker[] = [];
const queue: Job[] = [];
let nextId = 1;
let startFailures = 0;
let disabled = process.platform !== 'win32';

function giveUp(): void {
  disabled = true;
  for (const job of queue.splice(0)) job.resolve(null);
}

function onDeath(w: Worker): void {
  const idx = workers.indexOf(w);
  if (idx >= 0) workers.splice(idx, 1);
  // Never became ready: PowerShell or Add-Type is blocked (AppLocker, CLM…).
  if (!w.becameReady && ++startFailures >= MAX_START_FAILURES) return giveUp();
  dispatch();
}

function dispatch(): void {
  if (disabled) return giveUp();
  if (queue.length === 0) return;
  while (workers.length < POOL_SIZE) workers.push(new Worker(dispatch, onDeath));
  for (const w of workers) {
    if (w.dead || w.busy || queue.length === 0) continue;
    const lowBusy = workers.filter(x => x.current?.priority === 'low').length;
    const idx = queue.findIndex(j => j.priority === 'high' || lowBusy < MAX_LOW_BUSY);
    if (idx < 0) return;
    void w.run(queue.splice(idx, 1)[0]);
  }
}

/**
 * Size and newest file time of a folder via FindFirstFileEx. Resolves null when
 * unavailable (non-Windows, helper blocked, path unreadable) — callers then use
 * the Node walk. `low` is for browsing (details pane, explorer); scans and the
 * pre-delete safety check use `high` and always have a worker available.
 */
export function fastMeasure(dir: string, priority: Priority = 'high'): Promise<Result> {
  if (disabled || !path.isAbsolute(dir)) return Promise.resolve(null);
  return new Promise(resolve => {
    const job: Job = { id: nextId++, dir: path.resolve(dir), priority, resolve };
    // High-priority jobs go ahead of any waiting browsing work.
    const at = priority === 'high' ? queue.findIndex(j => j.priority === 'low') : -1;
    if (at >= 0) queue.splice(at, 0, job); else queue.push(job);
    dispatch();
  });
}

/** For tests and shutdown. */
export function stopFastMeasure(): void {
  disabled = true;
  for (const w of workers) w.kill();
  workers.length = 0;
  for (const job of queue.splice(0)) job.resolve(null);
}

process.once('exit', () => { for (const w of workers) w.kill(); });

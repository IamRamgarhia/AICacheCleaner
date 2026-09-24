import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
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
 * It runs as ONE long-lived PowerShell process with a small C# type compiled
 * once, measuring several folders at a time on its own threads. (Each process
 * launch blocks the backend for seconds in the unsigned packaged app while
 * antivirus inspects it, so one launch beats a pool of four.) Protocol: "id<TAB>base64(UTF-16 path)" in, "id<TAB>bytes,newestMs" or
 * "id<TAB>ERR" out. Base64 keeps any character in a path (José, 日本) intact
 * regardless of the console code page; the id means a stray line can never be
 * matched to the wrong folder. Anything that can't be measured answers ERR, so
 * the caller falls back to the Node walk — the helper can cost speed, never
 * correctness. Reparse points (junctions, symlinks) are skipped, like the walk.
 */
// Folders measured at the same time inside the one helper process.
const WORKER_THREADS = 4;

const CSHARP = `
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
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

  // One process, several folders at once: each request runs on the thread
  // pool, at most ${WORKER_THREADS} at a time; answers are written atomically.
  public static void Serve() {
    var slots = new SemaphoreSlim(${WORKER_THREADS});
    var outLock = new object();
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string req = line;
      slots.Wait();
      ThreadPool.QueueUserWorkItem(_ => {
        string id = "", result;
        try {
          string[] parts = req.Split(new[] { '\\t' }, 2);
          id = parts[0];
          result = Measure(Encoding.Unicode.GetString(Convert.FromBase64String(parts[1])));
        } catch { result = "ERR"; }
        lock (outLock) { Console.Out.WriteLine(id + "\\t" + result); Console.Out.Flush(); }
        slots.Release();
      });
    }
  }
}`;

const WORKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${CSHARP}
'@
[Console]::Out.WriteLine('READY')
[AiccFastDu]::Serve()`;

/**
 * The worker runs from a plain .ps1 file (-File), not -EncodedCommand. An
 * unsigned app launching PowerShell with an encoded script is a classic
 * malware pattern: antivirus inspected every launch, and each spawn blocked
 * the backend for ~4-7 s in the packaged app. The file name carries a hash of
 * its content, so a stale or tampered copy is never run.
 */
function workerScriptPath(): string {
  const hash = crypto.createHash('sha256').update(WORKER_SCRIPT).digest('hex').slice(0, 16);
  const file = path.join(os.tmpdir(), `aicc-fastdu-${hash}.ps1`);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== WORKER_SCRIPT) fs.writeFileSync(file, WORKER_SCRIPT, 'utf8');
  return file;
}

type Result = { bytes: number; newestMtimeMs: number } | null;
type Priority = 'high' | 'low';
interface Job { id: number; dir: string; priority: Priority; resolve: (v: Result) => void }

const READY_TIMEOUT_MS = 30_000;
// A whole drive can take minutes; past this the request falls back to the
// Node walk (the helper's thread finishes on its own and is ignored).
const JOB_TIMEOUT_MS = 10 * 60_000;
// Low-priority work (details pane, disk explorer) may never take every slot,
// so a delete's safety re-measure is never stuck behind it.
const MAX_LOW_IN_FLIGHT = WORKER_THREADS - 1;
const MAX_START_FAILURES = 2;

class Worker {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private ready: Promise<boolean>;
  private inFlight = new Map<number, { job: Job; timer: ReturnType<typeof setTimeout> }>();
  dead = false;
  becameReady = false;

  constructor(private onIdle: () => void, private onDeath: (w: Worker) => void) {
    // stdin carries only path data; the script itself comes from the file.
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', workerScriptPath()], { windowsHide: true });
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
      for (const id of [...this.inFlight.keys()]) this.settle(id, null);
      this.onDeath(this);
    };
    this.proc.on('exit', die);
    this.proc.on('error', die);
    // A write to a helper that just exited must not crash the backend.
    this.proc.stdin.on('error', die);
    this.hold(false);
  }

  get load(): number { return this.inFlight.size; }
  get lowLoad(): number { return [...this.inFlight.values()].filter(v => v.job.priority === 'low').length; }

  /** An idle helper must not keep Node alive (tests, CLI probes); a busy one must. */
  private hold(on: boolean): void {
    const handles = [this.proc, this.proc.stdout, this.proc.stdin, this.proc.stderr] as unknown as { ref?: () => void; unref?: () => void }[];
    for (const h of handles) (on ? h.ref : h.unref)?.call(h);
  }

  private settle(id: number, result: Result): void {
    const entry = this.inFlight.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.inFlight.delete(id);
    if (this.inFlight.size === 0) this.hold(false);
    entry.job.resolve(result);
  }

  async run(job: Job): Promise<void> {
    const timer = setTimeout(() => { this.settle(job.id, null); this.onIdle(); }, JOB_TIMEOUT_MS);
    this.inFlight.set(job.id, { job, timer });
    this.hold(true);
    if (!(await this.ready) || this.dead) {
      this.settle(job.id, null);
      this.onIdle();
      return;
    }
    const payload = Buffer.from(job.dir, 'utf16le').toString('base64');
    this.proc.stdin.write(`${job.id}\t${payload}\n`);
  }

  private finish(line: string): void {
    const [id, result = ''] = line.split('\t');
    const [b, ms] = result.split(',').map(Number);
    // Unknown ids (timed out, or stray output) are ignored.
    this.settle(Number(id), result === 'ERR' || !Number.isFinite(b) ? null : { bytes: b, newestMtimeMs: ms || 0 });
    this.onIdle();
  }

  kill(): void { try { this.proc.kill(); } catch { /* gone */ } }
}

let worker: Worker | null = null;
const queue: Job[] = [];
let nextId = 1;
let startFailures = 0;
let disabled = process.platform !== 'win32';

function giveUp(): void {
  disabled = true;
  for (const job of queue.splice(0)) job.resolve(null);
}

function onDeath(w: Worker): void {
  if (worker === w) worker = null;
  // Never became ready: PowerShell or Add-Type is blocked (AppLocker, CLM…).
  if (!w.becameReady && ++startFailures >= MAX_START_FAILURES) return giveUp();
  dispatch();
}

function dispatch(): void {
  if (disabled) return giveUp();
  if (queue.length === 0) return;
  worker ??= new Worker(dispatch, onDeath);
  while (queue.length > 0 && worker.load < WORKER_THREADS) {
    const lowAllowed = worker.lowLoad < MAX_LOW_IN_FLIGHT;
    const idx = queue.findIndex(j => j.priority === 'high' || lowAllowed);
    if (idx < 0) return;
    void worker.run(queue.splice(idx, 1)[0]);
  }
}

/**
 * Size and newest file time of a folder via FindFirstFileEx. Resolves null when
 * unavailable (non-Windows, helper blocked, path unreadable) — callers then use
 * the Node walk. `low` is for browsing (details pane, explorer); scans and the
 * pre-delete safety check use `high` and always have a slot available.
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
  worker?.kill();
  worker = null;
  for (const job of queue.splice(0)) job.resolve(null);
}

process.once('exit', () => { worker?.kill(); });

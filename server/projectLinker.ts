import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Project-centric view of AI data.
 *
 * Exporting whole tools is the wrong unit of work: "Antigravity" is 22 GB of
 * every project you have ever touched, and archiving it to move one project to
 * a new machine is absurd. What people actually want is "give me THIS project —
 * its code plus every AI conversation about it, wherever that lives".
 *
 * Three of the tools make that possible, each in a different way:
 *
 *  · Claude  — `~/.claude/projects/<encoded>` where <encoded> is the project's
 *              absolute path with every non-alphanumeric character replaced by
 *              a dash. `D:\calude\Krispy kulcha` → `D--calude-Krispy-kulcha`.
 *  · Cursor  — `workspaceStorage/<hash>/workspace.json` holds
 *              `{"folder":"file:///c%3A/..."}`, a URI we can decode.
 *  · Codex / Antigravity — their session metadata records NO workspace path, so
 *              their history genuinely cannot be attributed to a project. We
 *              report that rather than guessing.
 */

const home = os.homedir();
const appDataRoaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

const claudeProjectsRoot = path.join(home, '.claude', 'projects');
const cursorWorkspaceRoot = path.join(appDataRoaming, 'Cursor', 'User', 'workspaceStorage');

/** Claude's directory-name encoding for an absolute project path. */
export function encodeClaudeProjectDir(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function safeReadJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function listDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* locked */
        }
      }
    }
  }
  return total;
}

/** Decode a `file:///c%3A/Users/...` URI into a Windows path. */
function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file:///')) return null;
  try {
    let p = decodeURIComponent(uri.slice('file:///'.length));
    p = p.replace(/\//g, path.sep);
    // "c:\Users\..." → "C:\Users\..."
    if (/^[a-z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1);
    return p;
  } catch {
    return null;
  }
}

/**
 * Pull the working directory out of a Claude session file. Records early in a
 * session carry `cwd`; we stop at the first one rather than parsing the file.
 */
function readCwdFromSessions(dir: string, files: string[]): string | null {
  for (const file of files.slice(0, 3)) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n', 40)) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(line)?.cwd;
        if (typeof cwd === 'string' && cwd.trim()) return path.normalize(cwd);
      } catch {
        /* partial line */
      }
    }
  }
  return null;
}

export interface LinkedSource {
  tool: string;
  path: string;
  sizeBytes: number;
  /** Conversations / artifacts found, when countable. */
  entries?: number;
}

export interface ProjectLink {
  /** Absolute project path. */
  projectPath: string;
  name: string;
  /** True when the folder still exists on disk. */
  exists: boolean;
  sources: LinkedSource[];
  totalAiBytes: number;
}

/** Every AI data location that belongs to one specific project path. */
export function findSourcesForProject(projectPath: string): LinkedSource[] {
  const sources: LinkedSource[] = [];
  const normalized = path.normalize(projectPath).replace(/[\\/]+$/, '');

  // Claude — direct name encoding.
  const encoded = encodeClaudeProjectDir(normalized);
  const claudeDir = path.join(claudeProjectsRoot, encoded);
  if (fs.existsSync(claudeDir)) {
    let entries = 0;
    try {
      entries = fs.readdirSync(claudeDir).filter(f => f.endsWith('.jsonl')).length;
    } catch {
      /* unreadable */
    }
    sources.push({ tool: 'Claude', path: claudeDir, sizeBytes: dirSize(claudeDir), entries });
  }

  // Cursor — decode each workspace.json and compare folders.
  for (const hash of listDirs(cursorWorkspaceRoot)) {
    const wsDir = path.join(cursorWorkspaceRoot, hash);
    const ws = safeReadJson(path.join(wsDir, 'workspace.json'));
    const folder = ws?.folder ? fileUriToPath(ws.folder) : null;
    if (!folder) continue;
    if (path.normalize(folder).toLowerCase().replace(/[\\/]+$/, '') === normalized.toLowerCase()) {
      sources.push({ tool: 'Cursor', path: wsDir, sizeBytes: dirSize(wsDir) });
    }
  }

  return sources;
}

/**
 * Discover every project that has AI data attached, by reading the links
 * backwards: Claude's encoded directory names and Cursor's workspace folders.
 *
 * `candidatePaths` (from the drive scan) lets us recover the true project path
 * for Claude entries — its encoding is lossy (spaces and separators both become
 * dashes), so the folder name alone cannot be decoded reliably.
 */
export function discoverProjects(candidatePaths: string[] = []): ProjectLink[] {
  const byPath = new Map<string, ProjectLink>();

  const add = (projectPath: string, source: LinkedSource) => {
    const key = path.normalize(projectPath).toLowerCase();
    const existing = byPath.get(key);
    if (existing) {
      if (!existing.sources.some(s => s.path === source.path)) {
        existing.sources.push(source);
        existing.totalAiBytes += source.sizeBytes;
      }
      return;
    }
    byPath.set(key, {
      projectPath: path.normalize(projectPath),
      name: path.basename(projectPath) || projectPath,
      exists: fs.existsSync(projectPath),
      sources: [source],
      totalAiBytes: source.sizeBytes
    });
  };

  // Cursor gives us real paths directly.
  for (const hash of listDirs(cursorWorkspaceRoot)) {
    const wsDir = path.join(cursorWorkspaceRoot, hash);
    const ws = safeReadJson(path.join(wsDir, 'workspace.json'));
    const folder = ws?.folder ? fileUriToPath(ws.folder) : null;
    if (folder) add(folder, { tool: 'Cursor', path: wsDir, sizeBytes: dirSize(wsDir) });
  }

  // Claude: read the true project path out of the session records themselves.
  // Each turn carries a `cwd` field, which beats reverse-engineering the
  // directory name — that encoding turns both separators and spaces into
  // dashes, so it cannot be decoded back reliably.
  const encodedToReal = new Map<string, string>();
  for (const candidate of candidatePaths) {
    encodedToReal.set(encodeClaudeProjectDir(path.normalize(candidate).replace(/[\\/]+$/, '')), candidate);
  }
  for (const link of byPath.values()) {
    encodedToReal.set(encodeClaudeProjectDir(link.projectPath), link.projectPath);
  }

  for (const dirName of listDirs(claudeProjectsRoot)) {
    const claudeDir = path.join(claudeProjectsRoot, dirName);
    let sessionFiles: string[] = [];
    try {
      sessionFiles = fs.readdirSync(claudeDir).filter(f => f.endsWith('.jsonl'));
    } catch {
      /* unreadable */
    }
    if (sessionFiles.length === 0) continue;

    const real =
      readCwdFromSessions(claudeDir, sessionFiles) ?? encodedToReal.get(dirName) ?? dirName;

    add(real, {
      tool: 'Claude',
      path: claudeDir,
      sizeBytes: dirSize(claudeDir),
      entries: sessionFiles.length
    });
  }

  return [...byPath.values()].sort((a, b) => b.totalAiBytes - a.totalAiBytes);
}

/** Tools whose history cannot be attributed to a project. */
export const UNLINKABLE_TOOLS = [
  { tool: 'Antigravity', reason: 'its brain artifacts record no workspace path' },
  { tool: 'Codex', reason: 'its session index records no working directory' }
];

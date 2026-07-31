import fs from 'fs';
import path from 'path';
import os from 'os';

// Cross-app transcript reader / converter.
//
// Every tool stores its history differently, and the previous version assumed
// they were all "JSON files with a messages array". That was true only for
// Claude, so Antigravity and Cursor reported zero conversations despite having
// data on disk, and the dropdown ended up listing a single source. Each app now
// gets a reader that matches its ACTUAL on-disk format, and anything we cannot
// read is reported with a reason rather than silently hidden.

interface NormalizedMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface NormalizedConversation {
  id: string;
  source: string;
  title: string;
  messages: NormalizedMessage[];
}

// Roles that represent an actual conversational turn.
const CONVERSATION_ROLES = new Set(['user', 'assistant', 'system', 'human', 'model']);

/** Anthropic-style content is often an array of blocks ([{type:'text',text}]). */
function flattenContent(raw: any): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map(b => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof raw?.text === 'string') return raw.text;
  return '';
}

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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

function walkFiles(root: string, exts: string[], maxFiles: number): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < 5000) {
    visited++;
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (exts.includes(path.extname(entry.name).toLowerCase())) {
        out.push(full);
        if (out.length >= maxFiles) return out;
      }
    }
  }
  return out;
}

// --- Per-app readers -------------------------------------------------------

/** Claude Code / Desktop: one JSONL session file per conversation. */
function readClaude(root: string, limit: number): NormalizedConversation[] {
  const out: NormalizedConversation[] = [];
  for (const file of walkFiles(root, ['.jsonl'], limit)) {
    try {
      const messages: NormalizedMessage[] = [];
      for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        // Sessions interleave real turns with bookkeeping records
        // (queue-operation, file-history-snapshot, summary…).
        const role = obj.message?.role || obj.role || obj.type;
        if (!CONVERSATION_ROLES.has(role)) continue;
        const content = flattenContent(obj.message?.content ?? obj.content ?? obj.text);
        if (!content) continue;
        messages.push({ role, content, timestamp: obj.timestamp });
      }
      if (messages.length) {
        const id = path.basename(file);
        out.push({ id, source: 'claude', title: id.replace(/\.jsonl$/i, ''), messages });
      }
    } catch {
      /* unreadable file */
    }
  }
  return out;
}

/**
 * Antigravity: `brain/<uuid>/` holds Markdown work artifacts — task.md,
 * implementation_plan.md — each with a sidecar `<name>.metadata.json`
 * containing artifactType / summary / updatedAt. These are plans and task
 * lists, not chat turns, so they are exported as documents with the summary
 * as the title rather than pretending to be a dialogue.
 */
function readAntigravity(root: string, limit: number): NormalizedConversation[] {
  const out: NormalizedConversation[] = [];
  for (const dir of listDirs(root)) {
    if (out.length >= limit) break;
    const sessionDir = path.join(root, dir);

    let files: string[];
    try {
      files = fs.readdirSync(sessionDir).filter(f => f.toLowerCase().endsWith('.md'));
    } catch {
      continue;
    }
    if (!files.length) continue;

    const messages: NormalizedMessage[] = [];
    let title = '';

    for (const name of files) {
      const body = (() => {
        try {
          return fs.readFileSync(path.join(sessionDir, name), 'utf-8');
        } catch {
          return '';
        }
      })();
      if (!body.trim()) continue;

      const meta = readJson(path.join(sessionDir, `${name}.metadata.json`));
      if (!title && meta?.summary) title = meta.summary;

      messages.push({
        role: name.replace(/\.md$/i, ''),
        content: body,
        timestamp: meta?.updatedAt
      });
    }

    if (messages.length) {
      out.push({
        id: dir,
        source: 'antigravity',
        title: title || `Antigravity session ${dir.slice(0, 8)}`,
        messages
      });
    }
  }
  return out;
}

/**
 * Codex: `session_index.jsonl` lists threads (id, thread_name, updated_at).
 * The index carries titles and timestamps but not message bodies, so each
 * thread is exported as a single-entry record — honest about what we have.
 */
function readCodex(root: string, limit: number): NormalizedConversation[] {
  const indexPath = path.join(root, 'session_index.jsonl');
  if (!fs.existsSync(indexPath)) return [];
  const out: NormalizedConversation[] = [];
  try {
    for (const line of fs.readFileSync(indexPath, 'utf-8').split('\n')) {
      if (!line.trim() || out.length >= limit) break;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!obj?.id || !obj?.thread_name) continue;
      out.push({
        id: obj.id,
        source: 'codex',
        title: obj.thread_name,
        messages: [{ role: 'thread', content: obj.thread_name, timestamp: obj.updated_at }]
      });
    }
  } catch {
    /* unreadable */
  }
  return out;
}

/** Generic: JSON files carrying a messages[] or history[] array. */
function readGenericJson(root: string, kind: string, limit: number): NormalizedConversation[] {
  const out: NormalizedConversation[] = [];
  for (const file of walkFiles(root, ['.json'], limit * 4)) {
    if (out.length >= limit) break;
    const obj = readJson(file);
    if (!obj) continue;
    const raw = Array.isArray(obj.messages) ? obj.messages : Array.isArray(obj.history) ? obj.history : null;
    if (!raw) continue;
    const messages: NormalizedMessage[] = raw
      .map((m: any) => ({
        role: m.role || m.type || 'unknown',
        content: flattenContent(m.content ?? m.text),
        timestamp: m.timestamp || m.createdAt
      }))
      .filter((m: NormalizedMessage) => m.content);
    if (!messages.length) continue;
    const id = path.basename(file);
    out.push({ id, source: kind, title: obj.title || obj.name || id, messages });
  }
  return out;
}

// --- Registry --------------------------------------------------------------

const home = os.homedir();

export interface TranscriptSourceDef {
  id: string;
  label: string;
  roots: string[];
  read: (root: string, limit: number) => NormalizedConversation[];
  /** Set when the data exists but this tool cannot parse it (yet). */
  unreadableReason?: string;
}

export function transcriptSources(): TranscriptSourceDef[] {
  return [
    {
      id: 'Claude Code',
      label: 'Claude Code / Claude Desktop',
      roots: [path.join(home, '.claude', 'projects')],
      read: readClaude
    },
    {
      id: 'Antigravity',
      label: 'Antigravity (plans & tasks)',
      roots: [path.join(home, '.gemini', 'antigravity', 'brain')],
      read: readAntigravity
    },
    {
      id: 'Codex',
      label: 'Codex (thread titles)',
      roots: [path.join(home, '.codex')],
      read: readCodex
    },
    {
      id: 'Cursor AI',
      label: 'Cursor',
      roots: [
        path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage'),
        path.join(home, '.cursor')
      ],
      read: () => [],
      // Cursor keeps chats inside SQLite (state.vscdb). Reading that needs a
      // native sqlite binding, which would add a compiled dependency to a
      // portable Electron app — deliberately not done yet.
      unreadableReason: 'Cursor stores chats in a SQLite database that this tool cannot read yet'
    },
    {
      id: 'VS Code Copilot',
      label: 'VS Code Copilot',
      roots: [path.join(home, '.vscode')],
      read: (root, limit) => readGenericJson(root, 'vscode', limit)
    }
  ];
}

export interface TranscriptAppStatus {
  id: string;
  label: string;
  detected: boolean;
  readable: boolean;
  transcriptCount: number;
  reason?: string;
  root: string;
}

/** Probe cap — enough to prove a source works without walking a huge tree. */
const PROBE_LIMIT = 40;

export function listAvailableTranscriptApps(): TranscriptAppStatus[] {
  return transcriptSources().map(src => {
    const root = src.roots.find(r => fs.existsSync(r));
    const detected = !!root;

    if (!detected) {
      return { id: src.id, label: src.label, detected: false, readable: false, transcriptCount: 0, root: src.roots[0], reason: 'Not installed on this machine' };
    }
    if (src.unreadableReason) {
      return { id: src.id, label: src.label, detected: true, readable: false, transcriptCount: 0, root: root!, reason: src.unreadableReason };
    }

    const count = src.read(root!, PROBE_LIMIT).length;
    return {
      id: src.id,
      label: src.label,
      detected: true,
      readable: count > 0,
      transcriptCount: count,
      root: root!,
      reason: count === 0 ? 'Installed, but no readable transcripts found' : undefined
    };
  });
}

// --- Output ----------------------------------------------------------------

function toMarkdown(conv: NormalizedConversation): string {
  const lines: string[] = [`# ${conv.title}`, '', `*Source: ${conv.source} • ${conv.messages.length} entries*`, ''];
  for (const m of conv.messages) {
    lines.push(`## ${m.role}${m.timestamp ? `  \n*${m.timestamp}*` : ''}`, '');
    lines.push(m.content, '');
  }
  return lines.join('\n');
}

/** Serialise in the shape the TARGET tool actually uses on disk. */
function serializeForTarget(conv: NormalizedConversation, targetApp: string): { ext: string; body: string } {
  if (targetApp === 'Claude Code' || targetApp === 'Claude Desktop') {
    return {
      ext: '.jsonl',
      body: conv.messages.map(m => JSON.stringify({ role: m.role, content: m.content, timestamp: m.timestamp })).join('\n') + '\n'
    };
  }
  if (targetApp === 'Antigravity') {
    return {
      ext: '.json',
      body: JSON.stringify(
        { title: conv.title, source: conv.source, history: conv.messages.map(m => ({ role: m.role, text: m.content, timestamp: m.timestamp })) },
        null,
        2
      )
    };
  }
  return {
    ext: '.json',
    body: JSON.stringify({ title: conv.title, source: conv.source, messages: conv.messages }, null, 2)
  };
}

export interface ConvertResult {
  converted: number;
  message: string;
  outputDir?: string;
  files?: string[];
}

export function convertTranscripts(sourceApp: string, targetApp: string): ConvertResult {
  const src = transcriptSources().find(s => s.id === sourceApp || s.label === sourceApp);
  if (!src) {
    return { converted: 0, message: `"${sourceApp}" is not a supported source.` };
  }
  if (src.unreadableReason) {
    return { converted: 0, message: `${src.label}: ${src.unreadableReason}.` };
  }

  const root = src.roots.find(r => fs.existsSync(r));
  if (!root) {
    return { converted: 0, message: `${src.label} is not installed on this machine.` };
  }

  const conversations = src.read(root, 500);
  if (conversations.length === 0) {
    return { converted: 0, message: `No readable transcripts were found for ${src.label}.` };
  }

  const slug = `${sourceApp.replace(/[^a-zA-Z0-9]+/g, '_')}_to_${targetApp.replace(/[^a-zA-Z0-9]+/g, '_')}`;
  const outputDir = path.join(os.homedir(), 'Desktop', 'exported_transcripts', `${slug}_${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const written: string[] = [];
  let targetExt = '.json';
  conversations.forEach((conv, i) => {
    const stem = conv.id.replace(/\.(jsonl|json)$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const safeName = `${String(i + 1).padStart(3, '0')}_${stem}`;
    const { ext, body } = serializeForTarget(conv, targetApp);
    targetExt = ext;
    try {
      fs.writeFileSync(path.join(outputDir, `${safeName}${ext}`), body, 'utf-8');
      fs.writeFileSync(path.join(outputDir, `${safeName}.md`), toMarkdown(conv), 'utf-8');
      written.push(safeName);
    } catch {
      /* locked or permission-denied */
    }
  });

  return {
    converted: conversations.length,
    outputDir,
    files: written,
    message: `Converted ${conversations.length} ${src.label} record(s) into ${targetApp} format (${targetExt} + Markdown). Saved ${written.length * 2} files to ${outputDir}.`
  };
}

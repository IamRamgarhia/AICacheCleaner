import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import AdmZip from 'adm-zip';

export interface VaultFileManifest {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface VaultManifest {
  version: string;
  exportedAt: string;
  projectName: string;
  totalFiles: number;
  totalSizeBytes: number;
  files: VaultFileManifest[];
  description: string;
  includedSoftware: string[];
}

// Calculate SHA-256 hash of a file for integrity verification
function calculateFileHash(filePath: string): string {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch (e) {
    return 'unavailable';
  }
}

function emptyManifest(): VaultManifest {
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    projectName: '',
    totalFiles: 0,
    totalSizeBytes: 0,
    files: [],
    description: '',
    includedSoftware: []
  };
}

// Cheap recursive size probe used only to pre-flight the export budget.
function directorySizeSync(dirPath: string): number {
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // locked file — ignore
        }
      }
    }
  }
  return total;
}

// Path Sanitizer to prevent directory traversal attacks (e.g. ../../).
// Rejects any ".." segment — for both relative AND absolute paths — so callers
// cannot escape to an arbitrary location after normalization.
export function sanitizePath(inputPath: string): string {
  if (!inputPath) return process.cwd();
  const normalized = path.normalize(inputPath);

  // Reject leftover traversal segments after normalization. (path.normalize
  // collapses leading ".." but cannot resolve ".." that escapes beyond the
  // resolved root for absolute paths, so we also check the resolved form.)
  if (normalized.includes('..')) {
    throw new Error('Invalid path: Directory traversal detected.');
  }

  // For absolute paths, resolve and confirm the resolved form does not contain
  // a traversal that escapes its drive/root (e.g. C:\Windows\..\..\..\).
  if (path.isAbsolute(normalized)) {
    const resolved = path.resolve(normalized);
    if (resolved.includes('..')) {
      throw new Error('Invalid path: Directory traversal detected.');
    }
    return resolved;
  }

  return normalized;
}

// Which optional asset categories to package. All default ON for backwards
// compatibility; toggling one OFF simply omits its directories from the zip.
export interface IncludedAssets {
  sourceCode?: boolean;
  chatTranscripts?: boolean;
  vectorEmbeddings?: boolean;
  mcpBindings?: boolean;
  systemPrompts?: boolean;
  llmWeights?: boolean;
}

export async function exportProjectVault(
  projectDirPath?: string,
  outputZipPath?: string,
  selectedSoftwareIds: string[] = [],
  includedAssets?: IncludedAssets
): Promise<{ success: boolean; manifest: VaultManifest; zipPath: string; error?: string }> {
  // Resolve asset flags (default everything ON when unspecified).
  const assets: Required<IncludedAssets> = {
    sourceCode: includedAssets?.sourceCode !== false,
    chatTranscripts: includedAssets?.chatTranscripts !== false,
    vectorEmbeddings: includedAssets?.vectorEmbeddings !== false,
    mcpBindings: includedAssets?.mcpBindings !== false,
    systemPrompts: includedAssets?.systemPrompts !== false,
    llmWeights: includedAssets?.llmWeights === true
  };
  try {
    const cleanProjectPath = sanitizePath(projectDirPath || process.cwd());
    const zip = new AdmZip();
    const homeDir = os.homedir();
    const fileManifests: VaultFileManifest[] = [];
    let totalSizeBytes = 0;

    // Determine target output ZIP path
    const targetZipPath = outputZipPath && outputZipPath.trim().length > 0
      ? sanitizePath(outputZipPath)
      : path.join(homeDir, 'Desktop', `AICacheCleaner_Vault_${Date.now()}.zip`);

    // Ensure output directory exists
    const zipParentDir = path.dirname(targetZipPath);
    if (!fs.existsSync(zipParentDir)) {
      fs.mkdirSync(zipParentDir, { recursive: true });
    }

    // 1. Add Source Code & Project Files (excluding node_modules and .git)
    if (assets.sourceCode && fs.existsSync(cleanProjectPath)) {
      const addFolderRecursive = (dir: string, zipPrefix: string) => {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file === 'node_modules' || file === '.git' || file === '.next' || file === 'dist' || file === 'build') continue;
            
            const fullPath = path.join(dir, file);
            const relativeZipPath = path.join(zipPrefix, file).replace(/\\/g, '/');

            try {
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                addFolderRecursive(fullPath, relativeZipPath);
              } else if (stat.isFile()) {
                const hash = calculateFileHash(fullPath);
                fileManifests.push({
                  relativePath: relativeZipPath,
                  sizeBytes: stat.size,
                  sha256: hash
                });
                totalSizeBytes += stat.size;
                zip.addLocalFile(fullPath, zipPrefix);
              }
            } catch (e) {
              // Skip locked files gracefully
            }
          }
        } catch (e) {
          // Skip inaccessible folders
        }
      };

      addFolderRecursive(cleanProjectPath, 'code');
    }

    // 2. Attach selected AI memory & transcript directories.
    // Each path is tagged with an asset category so the IncludedAssets toggles
    // can filter what actually gets packaged.
    type AssetCategory = 'chatTranscripts' | 'vectorEmbeddings' | 'mcpBindings' | 'systemPrompts' | 'llmWeights';
    const softwarePathsMap: Record<string, { zipFolder: string; entries: { path: string; category: AssetCategory }[] }> = {
      'sw-antigravity': {
        zipFolder: 'ai_memories/antigravity',
        entries: [
          { path: path.join(homeDir, '.gemini', 'antigravity', 'brain'), category: 'chatTranscripts' },
          { path: path.join(homeDir, '.gemini'), category: 'systemPrompts' }
        ]
      },
      'sw-cursor': {
        zipFolder: 'ai_memories/cursor',
        entries: [{ path: path.join(homeDir, '.cursor'), category: 'chatTranscripts' }]
      },
      'sw-claude': {
        zipFolder: 'ai_memories/claude',
        entries: [
          { path: path.join(homeDir, '.claude', 'projects'), category: 'chatTranscripts' },
          { path: path.join(homeDir, '.claude'), category: 'systemPrompts' }
        ]
      },
      'sw-ollama': {
        zipFolder: 'ai_memories/ollama',
        entries: [
          { path: path.join(homeDir, '.ollama', 'models'), category: 'llmWeights' },
          { path: path.join(homeDir, '.ollama'), category: 'systemPrompts' }
        ]
      },
      'sw-vscode-mcp': {
        zipFolder: 'ai_memories/vscode_mcp',
        entries: [
          { path: path.join(homeDir, '.vscode'), category: 'mcpBindings' },
          { path: path.join(homeDir, '.mcp'), category: 'mcpBindings' }
        ]
      },
      'sw-opendevin': {
        zipFolder: 'ai_memories/opendevin',
        entries: [{ path: path.join(homeDir, '.opendevin'), category: 'chatTranscripts' }]
      },
      'sw-jan': {
        zipFolder: 'ai_memories/jan',
        entries: [
          { path: path.join(homeDir, '.jan', 'models'), category: 'llmWeights' },
          { path: path.join(homeDir, '.jan'), category: 'vectorEmbeddings' }
        ]
      },
      'sw-continue': {
        zipFolder: 'ai_memories/continue',
        entries: [{ path: path.join(homeDir, '.continue'), category: 'vectorEmbeddings' }]
      },
      'sw-huggingface-torch': {
        zipFolder: 'ai_memories/huggingface',
        entries: [
          { path: path.join(homeDir, '.cache', 'huggingface'), category: 'llmWeights' },
          { path: path.join(homeDir, '.cache', 'torch'), category: 'llmWeights' }
        ]
      }
    };

    const includedSoftware: string[] = [];

    // If no specific software selected, default to all available installed memory dirs
    const targetSwKeys = selectedSoftwareIds.length > 0
      ? selectedSoftwareIds
      : Object.keys(softwarePathsMap);

    // adm-zip builds the whole archive in memory. Enabling llmWeights can point
    // at tens of GB of Ollama/HuggingFace models, which used to OOM the process
    // with no warning. (Import already had a 5 GB guard; export had none.)
    const MAX_EXPORT_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
    let projectedBytes = totalSizeBytes;

    for (const swId of targetSwKeys) {
      const config = softwarePathsMap[swId];
      if (config) {
        let added = false;
        for (const entry of config.entries) {
          // Honor the asset-category toggles from the UI.
          if (!assets[entry.category]) continue;
          if (fs.existsSync(entry.path)) {
            const entryBytes = directorySizeSync(entry.path);
            projectedBytes += entryBytes;
            if (projectedBytes > MAX_EXPORT_BYTES) {
              // Name the ACTUAL culprit. This used to always blame the model
              // weights toggle even when that was switched off and something
              // else — a 22 GB tool directory — was responsible.
              const gb = (n: number) => (n / (1024 * 1024 * 1024)).toFixed(1);
              return {
                success: false,
                manifest: emptyManifest(),
                zipPath: targetZipPath,
                error:
                  `Too large to archive: ${gb(projectedBytes)} GB projected, limit is ` +
                  `${Math.round(MAX_EXPORT_BYTES / (1024 * 1024 * 1024))} GB. ` +
                  `"${swId.replace(/^sw-/, '')}" alone contributed ${gb(entryBytes)} GB (${entry.path}). ` +
                  `Deselect it, or export a single project instead of whole tools.`
              };
            }
            try {
              zip.addLocalFolder(entry.path, config.zipFolder);
              added = true;
            } catch (e) {
              // Ignore single file lock errors in subfolders
            }
          }
        }
        if (added) includedSoftware.push(swId);
      }
    }

    // 3. Generate SHA-256 Vault Manifest
    const manifest: VaultManifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      projectName: path.basename(cleanProjectPath),
      totalFiles: fileManifests.length,
      totalSizeBytes,
      files: fileManifests,
      description: 'Zero-Data-Loss Portable Project & AI Memory Vault (.zip)',
      includedSoftware
    };

    zip.addFile('vault_manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));
    zip.writeZip(targetZipPath);

    return {
      success: true,
      manifest,
      zipPath: targetZipPath
    };
  } catch (e) {
    return {
      success: false,
      manifest: emptyManifest(),
      zipPath: outputZipPath || '',
      error: (e as Error).message
    };
  }
}

/**
 * Export ONE project: its source tree plus every AI conversation linked to it.
 *
 * This is the unit people actually move between machines. The whole-tool export
 * above packages "all of Antigravity" (22 GB of every project you've touched),
 * which is useless for migrating a single piece of work.
 */
export async function exportSingleProject(
  projectPath: string,
  sources: { tool: string; path: string; sizeBytes: number; entries?: number }[],
  outputZipPath?: string,
  includeCode = true
): Promise<{
  success: boolean;
  zipPath: string;
  totalFiles: number;
  includedTools: string[];
  sizeBytes: number;
  formattedSize: string;
  error?: string;
}> {
  const projectName = path.basename(projectPath) || 'project';
  const targetZipPath =
    outputZipPath && outputZipPath.trim().length > 0
      ? sanitizePath(outputZipPath)
      : path.join(os.homedir(), 'Desktop', `${projectName.replace(/[^a-zA-Z0-9._-]+/g, '_')}_export_${Date.now()}.zip`);

  const fail = (error: string) => ({
    success: false,
    zipPath: targetZipPath,
    totalFiles: 0,
    includedTools: [] as string[],
    sizeBytes: 0,
    formattedSize: '0 B',
    error
  });

  try {
    // Budget check up front so a 20 GB project fails fast with a clear reason
    // rather than exhausting memory inside adm-zip.
    const MAX_PROJECT_EXPORT_BYTES = 4 * 1024 * 1024 * 1024;
    const codeBytes = includeCode ? directorySizeSync(projectPath) : 0;
    const aiBytes = sources.reduce((a, s) => a + s.sizeBytes, 0);
    const projected = codeBytes + aiBytes;
    const gb = (n: number) => (n / (1024 * 1024 * 1024)).toFixed(2);

    if (projected > MAX_PROJECT_EXPORT_BYTES) {
      return fail(
        `Project is too large to archive in one pass: ${gb(projected)} GB ` +
          `(code ${gb(codeBytes)} GB + AI history ${gb(aiBytes)} GB), limit ${gb(MAX_PROJECT_EXPORT_BYTES)} GB. ` +
          `Untick "Include project source" to export just the conversations.`
      );
    }

    const zip = new AdmZip();
    const includedTools: string[] = [];
    let totalFiles = 0;

    if (includeCode) {
      const addFolder = (dir: string, prefix: string) => {
        let entries: string[];
        try {
          entries = fs.readdirSync(dir);
        } catch {
          return;
        }
        for (const name of entries) {
          if (['node_modules', '.git', '.next', 'dist', 'build', '.venv', '__pycache__'].includes(name)) continue;
          const full = path.join(dir, name);
          const rel = path.join(prefix, name).replace(/\\/g, '/');
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) addFolder(full, rel);
            else if (stat.isFile()) {
              zip.addLocalFile(full, prefix);
              totalFiles++;
            }
          } catch {
            /* locked file */
          }
        }
      };
      addFolder(projectPath, 'code');
    }

    for (const source of sources) {
      if (!fs.existsSync(source.path)) continue;
      try {
        zip.addLocalFolder(source.path, `ai_history/${source.tool.toLowerCase()}`);
        includedTools.push(source.tool);
      } catch {
        /* skip unreadable source */
      }
    }

    const manifest = {
      version: '1.0.0',
      kind: 'single-project-export',
      exportedAt: new Date().toISOString(),
      projectPath,
      projectName,
      includedCode: includeCode,
      includedTools,
      sources: sources.map(s => ({ tool: s.tool, path: s.path, entries: s.entries ?? null })),
      note:
        'ai_history/<tool>/ holds the conversations that tool recorded for this project. ' +
        'Antigravity and Codex are absent by design: their session data records no workspace path, ' +
        'so it cannot be attributed to a single project.'
    };
    zip.addFile('project_manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

    const parent = path.dirname(targetZipPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    zip.writeZip(targetZipPath);

    const written = fs.existsSync(targetZipPath) ? fs.statSync(targetZipPath).size : 0;
    return {
      success: true,
      zipPath: targetZipPath,
      totalFiles,
      includedTools,
      sizeBytes: written,
      formattedSize: `${(written / (1024 * 1024)).toFixed(1)} MB`
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function importProjectVault(zipPath: string, targetExtractPath?: string): Promise<{ success: boolean; totalFilesExtracted: number; message?: string; error?: string }> {
  try {
    const cleanZipPath = sanitizePath(zipPath);
    const homeDir = os.homedir();
    const cleanExtractPath = targetExtractPath && targetExtractPath.trim().length > 0
      ? sanitizePath(targetExtractPath)
      : path.join(homeDir, 'Desktop', `Restored_Vault_${Date.now()}`);

    if (!fs.existsSync(cleanZipPath)) {
      return { success: false, totalFilesExtracted: 0, error: `Vault ZIP file not found at: ${cleanZipPath}` };
    }

    const zip = new AdmZip(cleanZipPath);
    const entries = zip.getEntries();
    
    // Verify Manifest
    const manifestEntry = entries.find(e => e.entryName === 'vault_manifest.json');
    if (!manifestEntry) {
      return { success: false, totalFilesExtracted: 0, error: 'Invalid Vault package: Missing vault_manifest.json' };
    }

    if (!fs.existsSync(cleanExtractPath)) {
      fs.mkdirSync(cleanExtractPath, { recursive: true });
    }

    // Zip-slip protection: verify EVERY entry resolves inside the target dir
    // before extracting. Also cap total entries/size to defuse decompression
    // bombs. (extractAllTo alone does not guard entry names.)
    const MAX_ENTRIES = 100000;
    const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
    const targetRoot = path.resolve(cleanExtractPath);
    let projectedSize = 0;

    for (const entry of entries) {
      if (entries.length > MAX_ENTRIES) {
        return { success: false, totalFilesExtracted: 0, error: 'Vault contains too many entries (possible zip bomb).' };
      }
      projectedSize += entry.header.size || 0;
      if (projectedSize > MAX_TOTAL_BYTES) {
        return { success: false, totalFilesExtracted: 0, error: 'Vault exceeds the maximum allowed size.' };
      }
      const resolvedEntry = path.resolve(targetRoot, entry.entryName);
      if (resolvedEntry !== targetRoot && !resolvedEntry.startsWith(targetRoot + path.sep)) {
        return { success: false, totalFilesExtracted: 0, error: `Zip-slip detected: entry "${entry.entryName}" escapes the target directory.` };
      }
    }

    zip.extractAllTo(cleanExtractPath, true);

    return {
      success: true,
      totalFilesExtracted: entries.length,
      message: `Successfully imported & unpacked ${entries.length} files to ${cleanExtractPath}`
    };
  } catch (e) {
    return {
      success: false,
      totalFilesExtracted: 0,
      error: (e as Error).message
    };
  }
}

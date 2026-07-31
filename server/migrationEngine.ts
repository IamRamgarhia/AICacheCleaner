import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { createStreamingArchive, type ArchiveEntry } from './streamingArchive';
import { updateExport } from './exportProgress';

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
    const homeDir = os.homedir();

    // Determine target output ZIP path
    const targetZipPath = outputZipPath && outputZipPath.trim().length > 0
      ? sanitizePath(outputZipPath)
      : path.join(homeDir, 'Desktop', `AICacheCleaner_Vault_${Date.now()}.zip`);

    // Ensure output directory exists
    const zipParentDir = path.dirname(targetZipPath);
    if (!fs.existsSync(zipParentDir)) {
      fs.mkdirSync(zipParentDir, { recursive: true });
    }

    // 1. Project source, streamed rather than buffered.
    //
    // The previous version walked the tree, read EVERY file into memory to
    // compute a SHA-256, and handed each one to adm-zip. Nothing ever verified
    // those hashes on import, so the cost bought nothing and the whole archive
    // still had to fit in RAM.
    const streamedSourceEntries: ArchiveEntry[] = [];
    if (assets.sourceCode && fs.existsSync(cleanProjectPath)) {
      streamedSourceEntries.push({
        source: cleanProjectPath,
        destination: 'code',
        ignore: ['node_modules', '.git', '.next', 'dist', 'build', '.venv', '__pycache__', '.turbo', '.cache']
      });
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

    // No size cap. The archive is streamed to disk (see streamingArchive.ts),
    // so a 40 GB selection is bounded by free space, not by memory. The old
    // 8 GB limit existed only because adm-zip buffered everything in RAM.
    const streamedEntries: ArchiveEntry[] = [];

    for (const swId of targetSwKeys) {
      const config = softwarePathsMap[swId];
      if (config) {
        let added = false;
        for (const entry of config.entries) {
          // Honor the asset-category toggles from the UI.
          if (!assets[entry.category]) continue;
          if (fs.existsSync(entry.path)) {
            streamedEntries.push({ source: entry.path, destination: config.zipFolder });
            added = true;
          }
        }
        if (added) includedSoftware.push(swId);
      }
    }

    // 3. Manifest + stream everything to disk
    const manifest: VaultManifest = {
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      projectName: path.basename(cleanProjectPath),
      totalFiles: 0,
      totalSizeBytes: 0,
      files: [],
      description: 'Portable AI memory & project archive (.zip), written as a stream — no size limit.',
      includedSoftware
    };

    const allEntries = [...streamedSourceEntries, ...streamedEntries];
    if (allEntries.length === 0) {
      return {
        success: false,
        manifest: emptyManifest(),
        zipPath: targetZipPath,
        error: 'Nothing selected to export.'
      };
    }

    const streamResult = await createStreamingArchive(
      targetZipPath,
      allEntries,
      [{ name: 'vault_manifest.json', content: JSON.stringify(manifest, null, 2) }],
      p => updateExport(p.filesProcessed, p.bytesProcessed, p.filesTotal, p.bytesTotal)
    );

    manifest.totalFiles = streamResult.filesArchived;
    manifest.totalSizeBytes = streamResult.archiveBytes;

    return {
      success: true,
      manifest,
      zipPath: streamResult.zipPath
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
  warnings?: string[];
  error?: string;
}> {
  const projectName = path.basename(projectPath) || 'project';
  const targetZipPath =
    outputZipPath && outputZipPath.trim().length > 0
      ? sanitizePath(outputZipPath)
      : path.join(os.homedir(), 'Desktop', `${projectName.replace(/[^a-zA-Z0-9._-]+/g, '_')}_export_${Date.now()}.zip`);

  let lastProgress = { filesProcessed: 0, bytesProcessed: 0 };

  const fail = (error: string) => ({
    success: false,
    zipPath: targetZipPath,
    totalFiles: 0,
    includedTools: [] as string[],
    sizeBytes: 0,
    formattedSize: '0 B',
    warnings: [] as string[],
    error
  });

  try {
    // No size ceiling: the archive is streamed to disk, so peak memory is flat
    // whether the project is 10 MB or 60 GB. The old adm-zip implementation
    // buffered everything in memory, which is why arbitrary 4/8 GB caps existed.
    const entries: ArchiveEntry[] = [];
    const includedTools: string[] = [];

    if (includeCode) {
      entries.push({
        source: projectPath,
        destination: 'code',
        // Reinstallable or regenerable — excluded so the archive stays useful
        // rather than enormous. Everything else in the project is included.
        ignore: ['node_modules', '.git', '.next', 'dist', 'build', '.venv', '__pycache__', '.turbo', '.cache']
      });
    }

    for (const source of sources) {
      if (!fs.existsSync(source.path)) continue;
      entries.push({ source: source.path, destination: `ai_history/${source.tool.toLowerCase()}` });
      includedTools.push(source.tool);
    }

    if (entries.length === 0) {
      return fail('Nothing to export: no project source selected and no linked AI history found.');
    }

    const manifest = {
      version: '1.1.0',
      kind: 'single-project-export',
      exportedAt: new Date().toISOString(),
      projectPath,
      projectName,
      includedCode: includeCode,
      includedTools,
      sources: sources.map(s => ({ tool: s.tool, path: s.path, entries: s.entries ?? null })),
      note:
        'code/ is the project source (node_modules, .git and build output excluded). ' +
        'ai_history/<tool>/ holds the conversations that tool recorded for this project. ' +
        'Antigravity and Codex are absent by design: their session data records no workspace path, ' +
        'so it cannot be attributed to a single project.'
    };

    const result = await createStreamingArchive(
      targetZipPath,
      entries,
      [{ name: 'project_manifest.json', content: JSON.stringify(manifest, null, 2) }],
      p => {
        lastProgress = p;
        updateExport(p.filesProcessed, p.bytesProcessed, p.filesTotal, p.bytesTotal);
      }
    );

    return {
      success: true,
      zipPath: result.zipPath,
      totalFiles: result.filesArchived || lastProgress.filesProcessed,
      includedTools,
      sizeBytes: result.archiveBytes,
      formattedSize: formatSize(result.archiveBytes),
      warnings: result.warnings.slice(0, 5)
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`;
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

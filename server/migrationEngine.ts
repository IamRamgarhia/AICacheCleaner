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

// Path Sanitizer to prevent directory traversal attacks (e.g. ../../)
export function sanitizePath(inputPath: string): string {
  const normalized = path.normalize(inputPath);
  if (normalized.includes('..') && !path.isAbsolute(normalized)) {
    throw new Error('Invalid path: Directory traversal detected.');
  }
  return normalized;
}

export async function exportProjectVault(projectDirPath: string, outputZipPath: string): Promise<{ success: boolean; manifest: VaultManifest; zipPath: string; error?: string }> {
  try {
    const cleanProjectPath = sanitizePath(projectDirPath || process.cwd());
    const zip = new AdmZip();
    const homeDir = os.homedir();
    const fileManifests: VaultFileManifest[] = [];
    let totalSizeBytes = 0;

    // 1. Add Source Code & Project Files (excluding node_modules and .git)
    if (fs.existsSync(cleanProjectPath)) {
      const addFolderRecursive = (dir: string, zipPrefix: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file === 'node_modules' || file === '.git' || file === '.next' || file === 'dist') continue;
          
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
      };

      addFolderRecursive(cleanProjectPath, 'code');
    }

    // 2. Attach local Antigravity AI transcripts if present
    const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');
    if (fs.existsSync(brainDir)) {
      zip.addLocalFolder(brainDir, 'ai_memories/antigravity');
    }

    // 3. Attach MCP Memory files if present
    const mcpMemoryDir = path.join(homeDir, '.mcp', 'memory');
    if (fs.existsSync(mcpMemoryDir)) {
      zip.addLocalFolder(mcpMemoryDir, 'ai_memories/mcp');
    }

    // 4. Generate SHA-256 Vault Manifest
    const manifest: VaultManifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      projectName: path.basename(cleanProjectPath),
      totalFiles: fileManifests.length,
      totalSizeBytes,
      files: fileManifests,
      description: 'Zero-Data-Loss Portable Project & AI Memory Vault (.project-ai.zip)'
    };

    zip.addFile('vault_manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));
    zip.writeZip(outputZipPath);

    return {
      success: true,
      manifest,
      zipPath: outputZipPath
    };
  } catch (e) {
    return {
      success: false,
      manifest: { version: '1.0.0', exportedAt: new Date().toISOString(), projectName: '', totalFiles: 0, totalSizeBytes: 0, files: [], description: '' },
      zipPath: '',
      error: (e as Error).message
    };
  }
}

export async function importProjectVault(zipPath: string, targetExtractPath: string): Promise<{ success: boolean; totalFilesExtracted: number; error?: string }> {
  try {
    const cleanZipPath = sanitizePath(zipPath);
    const cleanExtractPath = sanitizePath(targetExtractPath);

    if (!fs.existsSync(cleanZipPath)) {
      return { success: false, totalFilesExtracted: 0, error: 'Vault ZIP file not found' };
    }

    const zip = new AdmZip(cleanZipPath);
    const entries = zip.getEntries();
    
    // Verify Manifest
    const manifestEntry = entries.find(e => e.entryName === 'vault_manifest.json');
    if (!manifestEntry) {
      return { success: false, totalFilesExtracted: 0, error: 'Invalid Vault package: Missing vault_manifest.json' };
    }

    zip.extractAllTo(cleanExtractPath, true);

    return {
      success: true,
      totalFilesExtracted: entries.length
    };
  } catch (e) {
    return {
      success: false,
      totalFilesExtracted: 0,
      error: (e as Error).message
    };
  }
}

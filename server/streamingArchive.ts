import fs from 'fs';
import path from 'path';
// archiver v8 dropped the old `archiver('zip', opts)` factory in favour of
// named classes. It is ESM, but unlike `trash` it contains no `import.meta`
// usage, so esbuild can safely inline it into the CJS server bundle.
// `ZipArchive` already extends `Archiver` and wires up its own zip module, so
// it is constructed directly — wrapping it in another Archiver leaves
// `_module` unset and every append throws.
import { ZipArchive } from 'archiver';

/**
 * Streaming archive writer — no size ceiling.
 *
 * The previous exporter used adm-zip, which assembles the entire archive in
 * memory before writing it. That forced artificial caps (4 GB per project,
 * 8 GB per vault) and would still have exhausted memory on a large project.
 * Those caps were a workaround for the tool, not a real constraint on what a
 * user should be allowed to export.
 *
 * archiver pipes entries straight to a write stream, so peak memory stays flat
 * regardless of archive size and a 50 GB export is limited only by disk.
 */

export interface ArchiveEntry {
  /** Absolute path on disk. */
  source: string;
  /** Path inside the archive. */
  destination: string;
  /** Directories (by name) to skip when adding a folder. */
  ignore?: string[];
}

export interface ArchiveProgress {
  filesProcessed: number;
  bytesProcessed: number;
  /** archiver's own running totals for what it has actually queued. */
  filesTotal: number;
  bytesTotal: number;
}

export interface ArchiveResult {
  zipPath: string;
  filesArchived: number;
  bytesArchived: number;
  archiveBytes: number;
  warnings: string[];
}

/**
 * Write `entries` into a zip at `zipPath`, streaming throughout.
 * `onProgress` is invoked periodically so a caller can surface progress.
 */
export function createStreamingArchive(
  zipPath: string,
  entries: ArchiveEntry[],
  extraFiles: { name: string; content: string }[] = [],
  onProgress?: (p: ArchiveProgress) => void
): Promise<ArchiveResult> {
  return new Promise((resolve, reject) => {
    const parent = path.dirname(zipPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

    const output = fs.createWriteStream(zipPath);
    // Level 6: the default trade-off. Level 9 roughly doubles CPU time for a
    // few percent on already-compressed content like model weights.
    const archive: any = new (ZipArchive as any)({ zlib: { level: 6 } });
    const warnings: string[] = [];

    output.on('close', () => {
      resolve({
        zipPath,
        filesArchived: archive.pointer() > 0 ? (archive as any)._entriesCount ?? 0 : 0,
        bytesArchived: (archive as any)._entriesProcessedBytes ?? 0,
        archiveBytes: archive.pointer(),
        warnings
      });
    });

    output.on('error', reject);

    // ENOENT / EPERM on individual files are expected (locked files, files
    // deleted mid-archive) and must not abort the whole export.
    archive.on('warning', (err: NodeJS.ErrnoException) => {
      warnings.push(err.message);
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Still non-fatal, but worth recording.
        console.warn('[archive] warning:', err.message);
      }
    });

    archive.on('error', reject);

    if (onProgress) {
      archive.on('progress', (data: any) => {
        // Report archiver's OWN totals rather than a caller-side estimate of
        // the source tree. The caller cannot cheaply account for the ignore
        // list (node_modules, .git, build output), so its denominator was far
        // too large and the bar finished at ~21% on a completed export.
        onProgress({
          filesProcessed: data.entries.processed,
          bytesProcessed: data.fs.processedBytes,
          filesTotal: data.entries.total,
          bytesTotal: data.fs.totalBytes
        });
      });
    }

    archive.pipe(output);

    for (const entry of entries) {
      if (!fs.existsSync(entry.source)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(entry.source);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        archive.glob('**/*', {
          cwd: entry.source,
          dot: true,
          ignore: (entry.ignore ?? []).flatMap(dir => [`${dir}/**`, `**/${dir}/**`])
        }, { prefix: entry.destination });
      } else {
        archive.file(entry.source, { name: path.posix.join(entry.destination, path.basename(entry.source)) });
      }
    }

    for (const file of extraFiles) {
      archive.append(file.content, { name: file.name });
    }

    archive.finalize().catch(reject);
  });
}

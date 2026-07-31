// Recycle Bin / Trash bridge.
//
// `trash` is an ESM-only package that locates its platform helper binary with
// `new URL('windows-trash.exe', import.meta.url)`. `npm run build:server` bundles
// the server to CJS with esbuild, which rewrites `import.meta` to `{}` — so in
// the packaged app the binary was resolved against `undefined` and EVERY delete
// failed with `TypeError: Invalid URL`. It worked in dev (tsx keeps real ESM)
// and only broke in the shipped .exe, which is why it went unnoticed.
//
// Loading trash through a runtime dynamic import keeps it out of the bundle, so
// it always runs from node_modules with a real `import.meta.url`. The specifier
// is hidden behind `new Function` because esbuild rewrites any dynamic import it
// can statically analyse into a `require()`, which cannot load an ESM-only
// package.
//
// NOTE: electron-builder must keep this package outside the asar (see
// `asarUnpack` in electron-builder.json) — `windows-trash.exe` is spawned as a
// real process and cannot be executed from inside an archive.
//
// The `new Function` body below is a fixed literal with no interpolation, and
// the only specifier ever passed is the hardcoded constant 'trash', so there is
// no injection surface here — it exists purely to defeat esbuild's static
// analysis of the import.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<{ default: (paths: string[]) => Promise<void> }>;

type TrashFn = (paths: string[]) => Promise<void>;

let cached: TrashFn | null = null;

export async function loadTrash(): Promise<TrashFn> {
  if (cached) return cached;
  const mod = await dynamicImport('trash');
  if (typeof mod?.default !== 'function') {
    throw new Error('The "trash" package did not export a callable default.');
  }
  cached = mod.default;
  return cached;
}

/** Move a single path to the OS Recycle Bin / Trash. */
export async function moveToTrash(targetPath: string): Promise<void> {
  const trash = await loadTrash();
  await trash([targetPath]);
}

// Bundles a TypeScript entry to CommonJS for the tests. Uses esbuild's JS API:
// node_modules/esbuild/bin/esbuild is a JS shim only on Windows — on macOS and
// Linux it is a native binary, so running it through `node` broke CI there.
import { buildSync } from 'esbuild';

export function bundle(entry, outfile, external = []) {
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', target: 'node18', outfile, format: 'cjs', external, logLevel: 'silent' });
}

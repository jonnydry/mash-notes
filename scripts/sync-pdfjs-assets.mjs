/**
 * Copy pdf.js binary assets into static/ so the reader can fetch CMaps,
 * standard fonts, and WASM image decoders in both dev and production.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const destRoot = join(root, 'static', 'pdfjs');

rmSync(destRoot, { recursive: true, force: true });
mkdirSync(destRoot, { recursive: true });

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
	cpSync(join(pdfjsRoot, dir), join(destRoot, dir), { recursive: true });
}

console.log(`Synced pdf.js assets from ${pdfjsRoot} → static/pdfjs`);

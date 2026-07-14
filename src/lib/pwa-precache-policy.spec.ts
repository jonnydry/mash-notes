import { describe, expect, it } from 'vitest';
import {
	collectInitialManifestFiles,
	isExcludedFromPrecache,
	normalizePrecacheUrl,
	prunePrecacheEntries
} from '../../scripts/pwa-precache-policy.js';

const manifest = {
	start: { name: 'entry/start', file: '_app/immutable/entry/start.js', imports: ['shared'] },
	app: { name: 'entry/app', file: '_app/immutable/entry/app.js', imports: ['shared'] },
	layout: { name: 'nodes/0', file: '_app/immutable/nodes/0.js', imports: ['shared'] },
	page: {
		name: 'nodes/2',
		file: '_app/immutable/nodes/2.js',
		imports: ['shared'],
		css: ['_app/immutable/assets/page.css'],
		assets: ['_app/immutable/assets/core.woff2'],
		dynamicImports: ['reader']
	},
	shared: { file: '_app/immutable/chunks/shared.js' },
	reader: {
		name: 'PdfReader',
		file: '_app/immutable/chunks/pdf-reader.js',
		imports: ['shared', 'reader-vendor']
	},
	'reader-vendor': { file: '_app/immutable/chunks/pdf-vendor.js' }
};

describe('PWA precache policy', () => {
	it('normalizes Workbox and encoded static paths', () => {
		expect(normalizePrecacheUrl('/client/icons/Rotating%20Icons/Fried%20egg.png?rev=1')).toBe(
			'icons/Rotating Icons/Fried egg.png'
		);
	});

	it('collects only the statically imported initial graph', () => {
		const files = collectInitialManifestFiles(manifest);
		expect(files).toContain('_app/immutable/chunks/shared.js');
		expect(files).toContain('_app/immutable/assets/core.woff2');
		expect(files).not.toContain('_app/immutable/chunks/pdf-reader.js');
		expect(files).not.toContain('_app/immutable/chunks/pdf-vendor.js');
	});

	it('moves deferred code and optional static assets out of the precache', () => {
		const entries = [
			'_app/immutable/entry/start.js',
			'_app/immutable/chunks/shared.js',
			'_app/immutable/chunks/pdf-reader.js',
			'_app/immutable/chunks/pdf-vendor.js',
			'icons/Rotating Icons/Fried egg.png',
			'pdfjs/wasm/quickjs-eval.js',
			'icons/mash-monochrome.svg',
			'manifest.webmanifest',
			'icons/mash-logo-sprouts.png',
			'fonts/Excalifont-Regular.woff2'
		].map((url) => ({ url, revision: 'test', size: 1 }));

		expect(prunePrecacheEntries(entries, manifest).map((entry) => entry.url)).toEqual([
			'_app/immutable/entry/start.js',
			'_app/immutable/chunks/shared.js',
			'icons/mash-logo-sprouts.png',
			'fonts/Excalifont-Regular.woff2'
		]);
	});

	it('recognizes optional asset families after URL encoding', () => {
		expect(isExcludedFromPrecache('icons/Rotating%20Icons/Blue%20flame.png')).toBe(true);
		expect(isExcludedFromPrecache('/pdfjs/wasm/openjpeg_nowasm_fallback.js')).toBe(true);
		expect(isExcludedFromPrecache('icons/mash-icon-192.png')).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import {
	collectInitialManifestFiles,
	collectPrecachedLazyFiles,
	filesReferencedByIndexHtml,
	isExcludedFromPrecache,
	normalizePrecacheUrl,
	prunePrecacheEntries,
	requiredBootPrecacheFiles
} from '../../scripts/pwa-precache-policy.js';

const manifest = {
	start: {
		name: 'entry/start',
		file: '_app/immutable/entry/start.js',
		imports: ['payload', 'shared'],
		dynamicImports: ['client-entry']
	},
	payload: { name: 'entry/payload', file: '_app/immutable/entry/payload.js' },
	'client-entry': {
		name: 'client-entry',
		file: '_app/immutable/chunks/client-entry.js',
		imports: ['url', 'shared-errors']
	},
	url: { name: 'url', file: '_app/immutable/chunks/url.js' },
	'shared-errors': { file: '_app/immutable/chunks/shared-errors.js' },
	app: {
		name: 'entry/app',
		file: '_app/immutable/entry/app.js',
		imports: ['shared'],
		dynamicImports: ['layout', 'error-node', 'page', 'fallback', 'error-template']
	},
	layout: {
		name: 'nodes/0',
		file: '_app/immutable/nodes/0.js',
		imports: ['shared'],
		dynamicImports: ['pwa-register']
	},
	'error-node': { name: 'nodes/1', file: '_app/immutable/nodes/1.js', imports: ['shared'] },
	page: {
		name: 'nodes/2',
		file: '_app/immutable/nodes/2.js',
		imports: ['shared'],
		css: ['_app/immutable/assets/page.css'],
		assets: ['_app/immutable/assets/core.woff2'],
		dynamicImports: ['reader']
	},
	fallback: { name: 'nodes/3', file: '_app/immutable/nodes/3.js', imports: ['shared'] },
	'error-template': {
		name: 'error-template',
		file: '_app/immutable/chunks/error-template.js'
	},
	'pwa-register': {
		name: 'virtual_pwa-register',
		file: '_app/immutable/chunks/pwa-register.js'
	},
	shared: { file: '_app/immutable/chunks/shared.js' },
	reader: {
		name: 'PdfReader',
		file: '_app/immutable/chunks/pdf-reader.js',
		imports: ['shared', 'reader-vendor']
	},
	'reader-vendor': { file: '_app/immutable/chunks/pdf-vendor.js' },
	marked: {
		name: 'marked-runtime',
		file: '_app/immutable/chunks/marked-runtime.js',
		imports: ['shared', 'marked-lib']
	},
	'marked-lib': { file: '_app/immutable/chunks/marked-lib.js' }
};

describe('PWA precache policy', () => {
	it('normalizes Workbox and encoded static paths', () => {
		expect(normalizePrecacheUrl('/client/icons/Rotating%20Icons/Fried%20egg.png?rev=1')).toBe(
			'icons/Rotating Icons/Fried egg.png'
		);
	});

	it('follows Kit boot dynamic imports and leaves feature chunks lazy', () => {
		const files = collectInitialManifestFiles(manifest);
		expect(files).toContain('_app/immutable/chunks/shared.js');
		expect(files).toContain('_app/immutable/assets/core.woff2');
		expect(files).toContain('_app/immutable/chunks/client-entry.js');
		expect(files).toContain('_app/immutable/chunks/url.js');
		expect(files).toContain('_app/immutable/chunks/shared-errors.js');
		expect(files).toContain('_app/immutable/nodes/1.js');
		expect(files).toContain('_app/immutable/nodes/3.js');
		expect(files).toContain('_app/immutable/chunks/error-template.js');
		expect(files).toContain('_app/immutable/chunks/pwa-register.js');
		expect(files).not.toContain('_app/immutable/chunks/pdf-reader.js');
		expect(files).not.toContain('_app/immutable/chunks/pdf-vendor.js');
		expect(files).not.toContain('_app/immutable/chunks/marked-runtime.js');
		expect(files).not.toContain('_app/immutable/chunks/marked-lib.js');
	});

	it('moves deferred code and optional static assets out of the precache', () => {
		const entries = [
			'_app/immutable/entry/start.js',
			'_app/immutable/chunks/shared.js',
			'_app/immutable/chunks/pdf-reader.js',
			'_app/immutable/chunks/pdf-vendor.js',
			'_app/immutable/chunks/marked-runtime.js',
			'_app/immutable/chunks/marked-lib.js',
			'icons/Rotating Icons/Fried egg.png',
			'pdfjs/wasm/quickjs-eval.js',
			'icons/mash-monochrome.svg',
			'manifest.webmanifest',
			'_app/version.json',
			'icons/mash-logo-sprouts.png',
			'fonts/Excalifont-Regular.woff2'
		].map((url) => ({ url, revision: 'test', size: 1 }));

		expect(prunePrecacheEntries(entries, manifest).map((entry) => entry.url)).toEqual([
			'_app/immutable/entry/start.js',
			'_app/immutable/chunks/shared.js',
			'_app/immutable/chunks/marked-runtime.js',
			'_app/immutable/chunks/marked-lib.js',
			'manifest.webmanifest',
			'icons/mash-logo-sprouts.png',
			'fonts/Excalifont-Regular.woff2'
		]);
	});

	it('precaches the desk bundle import chunk outside the initial graph', () => {
		const withImport = {
			...manifest,
			sync: {
				name: 'sync-file',
				file: '_app/immutable/chunks/sync-file.js',
				imports: ['shared', 'sync-helper']
			},
			'sync-helper': { file: '_app/immutable/chunks/sync-helper.js' }
		};
		const initial = collectInitialManifestFiles(withImport);
		expect(initial.has('_app/immutable/chunks/sync-file.js')).toBe(false);
		expect(collectPrecachedLazyFiles(withImport)).toEqual(
			new Set(['_app/immutable/chunks/sync-file.js', '_app/immutable/chunks/sync-helper.js'])
		);

		const entries = [
			'_app/immutable/entry/start.js',
			'_app/immutable/chunks/shared.js',
			'_app/immutable/chunks/sync-file.js',
			'_app/immutable/chunks/sync-helper.js',
			'_app/immutable/chunks/pdf-reader.js'
		].map((url) => ({ url, revision: 'test', size: 1 }));

		expect(prunePrecacheEntries(entries, withImport).map((entry) => entry.url)).toEqual([
			'_app/immutable/entry/start.js',
			'_app/immutable/chunks/shared.js',
			'_app/immutable/chunks/sync-file.js',
			'_app/immutable/chunks/sync-helper.js'
		]);
	});

	it('requires every shell file index.html loads, including version.json', () => {
		const html = `
			<link rel="modulepreload" href="/_app/immutable/entry/start.js">
			<link rel="modulepreload" href="/_app/immutable/chunks/client-entry.js">
			<link rel="stylesheet" href="/_app/immutable/assets/page.css">
			<script type="module" src="/_app/immutable/entry/app.js"></script>
		`;
		const required = requiredBootPrecacheFiles(manifest, html);
		expect(required.has('_app/immutable/chunks/client-entry.js')).toBe(true);
		expect(required.has('_app/immutable/nodes/1.js')).toBe(true);
		expect(required.has('_app/immutable/assets/page.css')).toBe(true);
		expect(required.has('_app/version.json')).toBe(true);
		expect(filesReferencedByIndexHtml(html).has('_app/immutable/entry/start.js')).toBe(true);

		const precache = new Set(required);
		precache.delete('_app/immutable/nodes/1.js');
		const missing = [...required].filter((file) => !precache.has(file));
		expect(missing).toEqual(['_app/immutable/nodes/1.js']);
	});

	it('recognizes optional asset families after URL encoding', () => {
		expect(isExcludedFromPrecache('icons/Rotating%20Icons/Blue%20flame.png')).toBe(true);
		expect(isExcludedFromPrecache('/pdfjs/wasm/openjpeg_nowasm_fallback.js')).toBe(true);
		expect(isExcludedFromPrecache('icons/mash-icon-192.png')).toBe(false);
	});
});

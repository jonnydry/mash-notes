import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import { withPwa } from '@vite-pwa/sveltekit';
import { prunePrecacheEntries } from './scripts/pwa-precache-policy.js';

async function preparePwaPrecache(
	manifestEntries: Array<{ url: string; revision: string | null; size: number }>
) {
	let viteManifest: Record<
		string,
		{ name?: string; file: string; imports?: string[]; css?: string[]; assets?: string[] }
	>;
	try {
		viteManifest = JSON.parse(
			await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
		);
	} catch (error) {
		throw new Error('Could not enforce the PWA precache policy', { cause: error });
	}
	let manifest = prunePrecacheEntries(manifestEntries, viteManifest);

	// The static adapter creates index.html after Workbox generates the worker.
	// Add the SPA shell explicitly so navigation requests can be answered offline.
	try {
		const versionFile = await readFile('.svelte-kit/output/client/_app/version.json');
		manifest = manifest.filter((entry) => entry.url !== 'index.html');
		manifest.push({
			url: 'index.html',
			revision: createHash('sha256').update(versionFile).digest('hex'),
			size: 0
		});
	} catch (error) {
		throw new Error('Could not version the offline application shell', { cause: error });
	}

	return { manifest, warnings: [] };
}

export default defineConfig({
	optimizeDeps: {
		// gifuct-js is loaded only when exploding GIFs (dynamic import).
		include: ['js-binary-schema-parser']
	},
	plugins: [
		tailwindcss(),
		withPwa(
			{
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				csp: {
					mode: 'hash',
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'],
						'connect-src': ['self'],
						'font-src': ['self'],
						'img-src': ['self', 'data:', 'blob:'],
						'manifest-src': ['self'],
						'media-src': ['self', 'data:', 'blob:'],
						'worker-src': ['self', 'blob:'],
						'object-src': ['none'],
						'base-uri': ['none'],
						'form-action': ['none'],
						'frame-ancestors': ['none']
					}
				},
				// Static adapter for pure client-side PWA (per plan: easy self-host, static deploy)
				adapter: adapter({
					fallback: 'index.html' // SPA fallback for client routing / PWA
				}),
				// Kit 2 did not poll. Kit 3 polls hourly unless this is 0.
				version: { pollInterval: 0 }
			},
			{
				registerType: 'autoUpdate',
				// The layout registers the worker through virtual:pwa-register.
				// Kit 3 does not run Vite's transformIndexHtml hook, so the injected
				// registerSW.js script would be precached and never loaded.
				injectRegister: false,
				kit: {
					adapterFallback: 'index.html',
					spa: true
				},
				manifest: {
					name: 'Mash',
					short_name: 'Mash',
					description:
						'A fast, local-first scratch workbench for turning messy text and files into useful, portable results.',
					theme_color: '#0e0c0a',
					background_color: '#0e0c0a',
					display: 'standalone',
					icons: [
						{ src: '/icons/mash-icon-192.png', sizes: '192x192', type: 'image/png' },
						{ src: '/icons/mash-icon-512.png', sizes: '512x512', type: 'image/png' },
						{
							src: '/icons/mash-icon-512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable'
						}
					]
				},
				generateSW: {
					// vite-plugin-pwa 1 defaulted this to true. Workbox 8 defaults it to false.
					cleanupOutdatedCaches: true,
					// Hashed immutable files used to be precached with revision null.
					dontCacheBustURLsMatching: /^_app\/immutable\//,
					// Workbox 8 defaults this to true. The previous worker did not rewrite
					// extensionless URLs to .html files.
					cleanURLs: false,
					globPatterns: ['client/**/*.{js,mjs,css,html,ico,png,svg,webp,webmanifest,woff,woff2}'],
					manifestTransforms: [preparePwaPrecache],
					runtimeCaching: [
						{
							// Immutable, hashed assets that are intentionally absent from the precache
							// are cached after their feature is first used.
							urlPattern: /\/_app\/immutable\//,
							handler: 'CacheFirst',
							options: {
								cacheName: 'mash-deferred-assets-v2',
								expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 }
							}
						},
						{
							// The empty-desk cast is decorative. Cache characters as they appear and
							// fall back to the core precached mascot when a visit starts offline.
							urlPattern: /\/icons\/Rotating(?:%20| )Icons\//,
							handler: 'CacheFirst',
							options: {
								cacheName: 'mash-rotating-mascots-v1',
								expiration: { maxEntries: 24, maxAgeSeconds: 90 * 24 * 60 * 60 }
							}
						},
						{
							// PDF.js language/font/WASM support is only fetched after opening a PDF.
							urlPattern: /\/pdfjs\//,
							handler: 'CacheFirst',
							options: {
								cacheName: 'mash-pdf-support-v1',
								expiration: { maxEntries: 96, maxAgeSeconds: 30 * 24 * 60 * 60 }
							}
						}
					],
					modifyURLPrefix: { 'client/': '' }
				}
			}
		)
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

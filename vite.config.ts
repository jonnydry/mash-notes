import { defineConfig } from 'vitest/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
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
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
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
			workbox: {
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
		})
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

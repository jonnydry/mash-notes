import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
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
					'Mash your ideas together in a reliable place. Cute, fast, minimal web notes. Open source, private, keyboard-first PWA.',
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

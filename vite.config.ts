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
			manifest: {
				name: 'Mash',
				short_name: 'Mash',
				description:
					'Mash your ideas together in a reliable place. Cute, fast, minimal web notes. Open source, private, keyboard-first PWA.',
				theme_color: '#1a1814',
				background_color: '#1a1814',
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
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}']
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

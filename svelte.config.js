import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
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
		})
	}
};

export default config;

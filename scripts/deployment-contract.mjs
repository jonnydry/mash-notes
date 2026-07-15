export const SECURITY_HEADERS = Object.freeze([
	['Content-Security-Policy', "frame-ancestors 'none'"],
	['X-Content-Type-Options', 'nosniff'],
	['Referrer-Policy', 'no-referrer'],
	['X-Frame-Options', 'DENY'],
	['Cross-Origin-Opener-Policy', 'same-origin'],
	['Cross-Origin-Resource-Policy', 'same-origin'],
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()']
]);

export const CACHE_CONTROL = Object.freeze({
	immutable: 'public, max-age=31536000, immutable',
	revalidate: 'public, max-age=0, must-revalidate'
});

export const VERCEL_CACHE_SOURCES = Object.freeze([
	['/_app/immutable/(.*)', CACHE_CONTROL.immutable],
	['/', CACHE_CONTROL.revalidate],
	['/index.html', CACHE_CONTROL.revalidate],
	['/sw.js', CACHE_CONTROL.revalidate],
	['/boot-theme.js', CACHE_CONTROL.revalidate],
	['/manifest.webmanifest', CACHE_CONTROL.revalidate]
]);

export const STATIC_CACHE_SOURCES = Object.freeze([
	['/_app/immutable/*', CACHE_CONTROL.immutable],
	['/', CACHE_CONTROL.revalidate],
	['/index.html', CACHE_CONTROL.revalidate],
	['/sw.js', CACHE_CONTROL.revalidate],
	['/boot-theme.js', CACHE_CONTROL.revalidate],
	['/manifest.webmanifest', CACHE_CONTROL.revalidate]
]);

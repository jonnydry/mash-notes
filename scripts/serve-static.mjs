import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { CACHE_CONTROL, SECURITY_HEADERS } from './deployment-contract.mjs';

const args = process.argv.slice(2);

function readArgument(name, fallback) {
	const index = args.indexOf(name);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const host = readArgument('--host', '127.0.0.1');
const port = Number(readArgument('--port', '4173'));
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(`Invalid preview port: ${port}`);
}

const root = resolve('build');
try {
	if (!(await stat(resolve(root, 'index.html'))).isFile()) throw new Error('Missing index.html');
} catch {
	throw new Error('Static build not found. Run `npm run build` before `npm run preview`.');
}

const mimeTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.gif', 'image/gif'],
	['.html', 'text/html; charset=utf-8'],
	['.ico', 'image/x-icon'],
	['.jpeg', 'image/jpeg'],
	['.jpg', 'image/jpeg'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.mjs', 'text/javascript; charset=utf-8'],
	['.pdf', 'application/pdf'],
	['.png', 'image/png'],
	['.svg', 'image/svg+xml'],
	['.txt', 'text/plain; charset=utf-8'],
	['.wasm', 'application/wasm'],
	['.webmanifest', 'application/manifest+json; charset=utf-8'],
	['.webp', 'image/webp'],
	['.woff', 'font/woff'],
	['.woff2', 'font/woff2']
]);

function applyHeaders(response, pathname) {
	for (const [name, value] of SECURITY_HEADERS) response.setHeader(name, value);

	if (pathname.startsWith('/_app/immutable/')) {
		response.setHeader('Cache-Control', CACHE_CONTROL.immutable);
	} else if (pathname === '/sw.js') {
		response.setHeader('Cache-Control', CACHE_CONTROL.revalidate);
		response.setHeader('Service-Worker-Allowed', '/');
	} else if (
		pathname === '/' ||
		pathname.endsWith('.html') ||
		pathname === '/boot-theme.js' ||
		pathname === '/manifest.webmanifest'
	) {
		response.setHeader('Cache-Control', CACHE_CONTROL.revalidate);
	}
}

async function findFile(pathname, acceptsHtml) {
	const requested = resolve(root, `.${pathname}`);
	if (requested !== root && !requested.startsWith(`${root}${sep}`)) return null;

	try {
		const details = await stat(requested);
		if (details.isFile()) return requested;
		if (details.isDirectory()) {
			const indexFile = resolve(requested, 'index.html');
			if ((await stat(indexFile)).isFile()) return indexFile;
		}
	} catch {
		// Fall through to the SPA shell for browser navigations.
	}

	return acceptsHtml ? resolve(root, 'index.html') : null;
}

const server = createServer(async (request, response) => {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405, { Allow: 'GET, HEAD' });
		response.end('Method not allowed');
		return;
	}

	let pathname;
	try {
		pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
		if (pathname.includes('\0')) throw new Error('Invalid path');
	} catch {
		response.writeHead(400);
		response.end('Bad request');
		return;
	}

	const acceptsHtml = request.headers.accept?.includes('text/html') ?? false;
	const file = await findFile(pathname, acceptsHtml);
	if (!file) {
		response.writeHead(404);
		response.end('Not found');
		return;
	}

	const details = await stat(file);
	applyHeaders(response, pathname);
	response.setHeader('Content-Type', mimeTypes.get(extname(file)) ?? 'application/octet-stream');
	response.setHeader('Content-Length', details.size);
	response.writeHead(200);
	if (request.method === 'HEAD') response.end();
	else createReadStream(file).pipe(response);
});

server.listen(port, host, () => {
	console.log(`Mash static preview: http://${host}:${port}`);
});

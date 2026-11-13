/**
 * Offline boot proof.
 * `node scripts/offline-nostore-proof.mjs build` serves ./build with Cache-Control: no-store.
 * `node scripts/offline-nostore-proof.mjs https://host` uses that origin as-is.
 *
 * Fresh context, service worker installed, HTTP cache cleared, runtime caches
 * deleted, then a hard reload while offline. Also fetches the error-page node
 * (nodes/1) and the fallback node (nodes/3) while offline.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const target = process.argv[2];
if (!target) {
	console.error('Usage: node scripts/offline-nostore-proof.mjs build|https://host');
	process.exit(1);
}

const root = resolve('build');

function startNoStoreServer() {
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		let pathname = decodeURIComponent(url.pathname);
		if (pathname.endsWith('/')) pathname += 'index.html';
		const file = resolve(root, `.${pathname}`);
		const inside = file === root || file.startsWith(`${root}${sep}`);
		response.setHeader('Cache-Control', 'no-store');
		try {
			if (!inside || !(await stat(file)).isFile()) {
				if (request.headers.accept?.includes('text/html')) {
					response.setHeader('Content-Type', 'text/html; charset=utf-8');
					createReadStream(resolve(root, 'index.html')).pipe(response);
					return;
				}
				response.writeHead(404);
				response.end('missing');
				return;
			}
			const types = new Map([
				['.css', 'text/css; charset=utf-8'],
				['.html', 'text/html; charset=utf-8'],
				['.js', 'text/javascript; charset=utf-8'],
				['.json', 'application/json; charset=utf-8'],
				['.png', 'image/png'],
				['.svg', 'image/svg+xml'],
				['.webmanifest', 'application/manifest+json; charset=utf-8'],
				['.woff2', 'font/woff2']
			]);
			response.setHeader('Content-Type', types.get(extname(file)) ?? 'application/octet-stream');
			createReadStream(file).pipe(response);
		} catch {
			response.writeHead(500);
			response.end('error');
		}
	});
	return new Promise((resolvePromise) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('No port');
			resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
		});
	});
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text());
});

let server;
let origin = target;
if (target === 'build') {
	({ server, origin } = await startNoStoreServer());
	console.log(`no-store server ${origin}`);
} else {
	console.log(`remote ${origin}`);
}

try {
	await page.goto(origin, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(
		async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
		undefined,
		{ timeout: 30_000 }
	);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
		timeout: 15_000
	});
	await page.getByRole('navigation', { name: 'Mash dock' }).waitFor({ timeout: 30_000 });

	const client = await context.newCDPSession(page);
	await client.send('Network.clearBrowserCache');
	const deletedCaches = await page.evaluate(async () => {
		const keys = await caches.keys();
		const removed = [];
		for (const key of keys) {
			if (!key.includes('precache')) {
				await caches.delete(key);
				removed.push(key);
			}
		}
		return { kept: keys.filter((key) => key.includes('precache')), removed };
	});
	console.log(`cleared HTTP cache; deleted runtime caches ${JSON.stringify(deletedCaches)}`);

	const shell = await (await page.request.get(origin)).text();
	const appPath = shell.match(/\/_app\/immutable\/entry\/app\.[^"']+\.js/)?.[0];
	const startPath = shell.match(/\/_app\/immutable\/entry\/start\.[^"']+\.js/)?.[0];
	if (!appPath || !startPath) throw new Error('Shell is missing app or start entry');
	const appSource = await (await page.request.get(`${origin}${appPath}`)).text();
	const startSource = await (await page.request.get(`${origin}${startPath}`)).text();
	const nodes1 = appSource.match(/nodes\/1\.[A-Za-z0-9_-]+\.js/)?.[0];
	const nodes3 = appSource.match(/nodes\/3\.[A-Za-z0-9_-]+\.js/)?.[0];
	const clientEntry = startSource.match(/chunks\/[A-Za-z0-9_-]+\.js/)?.[0];
	console.log(
		`boot urls nodes/1=${nodes1 ?? 'missing'} nodes/3=${nodes3 ?? 'missing'} client-entry=${clientEntry ?? 'missing'}`
	);

	await context.setOffline(true);
	pageErrors.length = 0;
	const reloaded = [];
	const trackAppFile = (url) =>
		url.includes('/_app/immutable/') || url.endsWith('/_app/version.json');
	page.on('response', (response) => {
		const url = response.url();
		if (trackAppFile(url)) {
			reloaded.push({
				url: url.replace(origin, ''),
				status: response.status(),
				fromServiceWorker: response.fromServiceWorker()
			});
		}
	});
	page.on('requestfailed', (request) => {
		if (trackAppFile(request.url())) {
			reloaded.push({
				url: request.url().replace(origin, ''),
				failed: request.failure()?.errorText ?? 'failed',
				fromServiceWorker: false
			});
		}
	});
	try {
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.getByRole('navigation', { name: 'Mash dock' }).waitFor({ timeout: 30_000 });
	} catch (error) {
		console.log(
			JSON.stringify(
				{
					reloadError: String(error).split('\n')[0],
					pageErrors,
					consoleErrors: consoleErrors.slice(0, 12),
					reloaded: reloaded.slice(0, 20)
				},
				null,
				2
			)
		);
		throw error;
	}
	const offlineDock = await page.getByRole('navigation', { name: 'Mash dock' }).count();

	async function fetchOffline(relativePath) {
		if (!relativePath)
			return { path: relativePath, ok: false, status: 0, fromServiceWorker: false };
		const absolute = relativePath.startsWith('/')
			? new URL(relativePath, origin).href
			: new URL(relativePath, `${origin}/_app/immutable/`).href;
		const response = await page.evaluate(async (url) => {
			try {
				const result = await fetch(url);
				return { ok: result.ok, status: result.status };
			} catch (error) {
				return { ok: false, status: 0, error: String(error) };
			}
		}, absolute);
		const seen = reloaded.find((entry) => entry.url.endsWith(relativePath));
		return {
			path: relativePath,
			...response,
			fromServiceWorker: seen?.fromServiceWorker ?? null
		};
	}

	const fetched = {
		nodes1: await fetchOffline(nodes1),
		nodes3: await fetchOffline(nodes3),
		clientEntry: await fetchOffline(clientEntry),
		version: await fetchOffline('/_app/version.json')
	};
	const reloadBoot = {
		nodes1: reloaded.find((entry) => nodes1 && entry.url.includes(nodes1)) ?? null,
		nodes3: reloaded.find((entry) => nodes3 && entry.url.includes(nodes3)) ?? null,
		clientEntry: reloaded.find((entry) => clientEntry && entry.url.includes(clientEntry)) ?? null
	};

	let fallbackDock = 0;
	let fallbackError = '';
	try {
		await page.goto(`${origin}/not-a-real-route`, { waitUntil: 'domcontentloaded' });
		await page.getByRole('navigation', { name: 'Mash dock' }).waitFor({ timeout: 30_000 });
		fallbackDock = await page.getByRole('navigation', { name: 'Mash dock' }).count();
	} catch (error) {
		fallbackError = String(error).split('\n')[0];
	}

	console.log(
		JSON.stringify(
			{
				origin,
				offlineDock,
				pageErrors,
				consoleErrors: consoleErrors.slice(0, 8),
				immutableResponses: reloaded.length,
				immutableFromServiceWorker: reloaded.filter((entry) => entry.fromServiceWorker).length,
				fetched,
				reloadBoot,
				fallbackDock,
				fallbackError
			},
			null,
			2
		)
	);
	if (
		offlineDock !== 1 ||
		fallbackDock !== 1 ||
		pageErrors.length > 0 ||
		!fetched.nodes1.ok ||
		!fetched.nodes3.ok ||
		!fetched.clientEntry.ok ||
		!fetched.version.ok ||
		fetched.version.fromServiceWorker !== true
	) {
		process.exitCode = 1;
	}
} finally {
	await browser.close();
	server?.close();
}

import { readFile } from 'node:fs/promises';
import {
	SECURITY_HEADERS,
	STATIC_CACHE_SOURCES,
	VERCEL_CACHE_SOURCES
} from './deployment-contract.mjs';

const errors = [];

function requireValue(condition, message) {
	if (!condition) errors.push(message);
}

function headerMap(entries = []) {
	return new Map(entries.map(({ key, value }) => [String(key).toLowerCase(), String(value)]));
}

function requireHeader(headers, name, value, location) {
	const actual = headers.get(name.toLowerCase());
	if (actual !== value) {
		errors.push(`${location} must set ${name}: ${value}${actual ? ` (found ${actual})` : ''}`);
	}
}

function parseStaticHeaders(raw) {
	const routes = new Map();
	let route = null;
	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) continue;
		if (!/^\s/.test(line)) {
			route = line.trim();
			routes.set(route, new Map());
			continue;
		}
		if (!route) continue;
		const separator = line.indexOf(':');
		if (separator < 0) continue;
		const name = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		routes.get(route).set(name, value);
	}
	return routes;
}

const [vercelRaw, staticHeadersRaw, buildIndex, builtHeaders] = await Promise.all([
	readFile('vercel.json', 'utf8'),
	readFile('static/_headers', 'utf8'),
	readFile('build/index.html', 'utf8'),
	readFile('build/_headers', 'utf8')
]);

const vercel = JSON.parse(vercelRaw);
requireValue(
	vercel.$schema === 'https://openapi.vercel.sh/vercel.json',
	'vercel.json needs the Vercel schema'
);
requireValue(vercel.framework === 'sveltekit', 'vercel.json must declare the SvelteKit framework');
requireValue(
	vercel.outputDirectory === 'build',
	'vercel.json must deploy the static build/ directory'
);
requireValue(
	vercel.buildCommand === 'npm run build && npm run check:deploy',
	'Vercel must build and verify the deployment contract before publishing'
);
requireValue(
	vercel.rewrites?.some((rule) => rule.source === '/(.*)' && rule.destination === '/index.html'),
	'vercel.json must preserve the static SPA fallback'
);

const globalVercelRule = vercel.headers?.find((rule) => rule.source === '/(.*)');
const globalVercelHeaders = headerMap(globalVercelRule?.headers);
for (const [name, value] of SECURITY_HEADERS) {
	requireHeader(globalVercelHeaders, name, value, 'vercel.json global headers');
}
for (const [source, cacheControl] of VERCEL_CACHE_SOURCES) {
	const rule = vercel.headers?.find((candidate) => candidate.source === source);
	requireHeader(headerMap(rule?.headers), 'Cache-Control', cacheControl, `vercel.json ${source}`);
}
const swRule = vercel.headers?.find((candidate) => candidate.source === '/sw.js');
requireHeader(headerMap(swRule?.headers), 'Service-Worker-Allowed', '/', 'vercel.json /sw.js');

const staticRoutes = parseStaticHeaders(staticHeadersRaw);
for (const [name, value] of SECURITY_HEADERS) {
	requireHeader(staticRoutes.get('/*') ?? new Map(), name, value, 'static/_headers /*');
}
for (const [source, cacheControl] of STATIC_CACHE_SOURCES) {
	requireHeader(
		staticRoutes.get(source) ?? new Map(),
		'Cache-Control',
		cacheControl,
		`static/_headers ${source}`
	);
}
requireHeader(
	staticRoutes.get('/sw.js') ?? new Map(),
	'Service-Worker-Allowed',
	'/',
	'static/_headers /sw.js'
);

requireValue(
	builtHeaders.trim() === staticHeadersRaw.trim(),
	'build/_headers must be the exact static-host header contract'
);
for (const directive of [
	"default-src 'self'",
	"script-src 'self'",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'"
]) {
	requireValue(buildIndex.includes(directive), `Generated index CSP is missing ${directive}`);
}
requireValue(
	globalVercelHeaders.get('content-security-policy') === "frame-ancestors 'none'",
	'Framing protection must be delivered as an HTTP CSP header, not only as meta CSP'
);

if (errors.length > 0) {
	console.error(`Deployment contract failed:\n- ${errors.join('\n- ')}`);
	process.exitCode = 1;
} else {
	console.log('Deployment contract verified: Vercel + portable static host + generated CSP');
}

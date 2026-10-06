import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const SECRET_ENV_KEYS = [];

export const ORIGIN_ENV_KEYS = [];

export const APP_SCAN_PATHS = [
	'src',
	'scripts',
	'playwright.config.ts',
	'vite.config.ts',
	'svelte.config.js'
];

export const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const EVIDENCE_DIR = '/opt/cursor/artifacts/verify-mash-notes';

export const DEFAULT_STATE_DIR = '/tmp/verify-mash-notes';

export const DEFAULT_PORT = 4183;

const KEPT_ENV = [
	'PATH',
	'HOME',
	'USER',
	'LOGNAME',
	'TMPDIR',
	'TMP',
	'TEMP',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'SHELL',
	'TERM'
];

const SECRET_MARKERS = [
	'API_KEY',
	'SECRET',
	'TOKEN',
	'PASSWORD',
	'PASSWD',
	'CREDENTIAL',
	'PRIVATE_KEY',
	'DATABASE_URL',
	'DSN'
];

const SKIP_DIRS = new Set([
	'node_modules',
	'build',
	'.svelte-kit',
	'.git',
	'pdfjs',
	'test-results',
	'playwright-report'
]);

const TEXT_EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte']);

export function isSecretEnvName(name) {
	const upper = name.toUpperCase();
	return SECRET_MARKERS.some((marker) => upper.includes(marker));
}

export function isOriginEnvName(name) {
	if (isSecretEnvName(name)) return false;
	const upper = name.toUpperCase();
	return (
		upper === 'HOST' ||
		upper.endsWith('_URL') ||
		upper.endsWith('_ORIGIN') ||
		upper.endsWith('_BASE') ||
		upper.endsWith('_ENDPOINT')
	);
}

export function envNamesInSource(source) {
	const pattern =
		/(?:process\.env|import\.meta\.env)(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;
	const names = [];
	for (const match of source.matchAll(pattern)) names.push(match[1] || match[2]);
	return names;
}

async function walk(target, names) {
	let info;
	try {
		info = await stat(target);
	} catch {
		return;
	}
	if (info.isDirectory()) {
		if (SKIP_DIRS.has(path.basename(target))) return;
		const entries = await readdir(target);
		for (const entry of entries) await walk(path.join(target, entry), names);
		return;
	}
	if (!TEXT_EXT.has(path.extname(target))) return;
	const source = await readFile(target, 'utf8');
	for (const name of envNamesInSource(source)) names.add(name);
}

export async function collectEnvNames(repoRoot, relativePaths = APP_SCAN_PATHS) {
	const names = new Set();
	for (const relativePath of relativePaths) {
		await walk(path.join(repoRoot, relativePath), names);
	}
	return [...names].sort();
}

export function namesMatching(names, predicate) {
	return names.filter(predicate).sort();
}

export function childEnvForLaunch(parent, origin) {
	const child = {};
	for (const key of KEPT_ENV) {
		if (typeof parent[key] === 'string' && parent[key] !== '') child[key] = parent[key];
	}
	for (const key of Object.keys(parent)) {
		if (isSecretEnvName(key)) child[key] = '';
		else if (isOriginEnvName(key)) child[key] = origin;
	}
	for (const key of SECRET_ENV_KEYS) child[key] = '';
	for (const key of ORIGIN_ENV_KEYS) child[key] = origin;
	return child;
}

export function requestDecision(rawUrl) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, host: '', reason: 'unparseable' };
	}
	if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') {
		return { ok: true, host: url.hostname, reason: 'local-scheme' };
	}
	if (LOCAL_HOSTS.has(url.hostname)) return { ok: true, host: url.hostname, reason: 'local-host' };
	return { ok: false, host: url.hostname, reason: 'non-local-host' };
}

export function deletionTarget(target, evidenceDir = EVIDENCE_DIR) {
	const resolved = path.resolve(target);
	const evidence = path.resolve(evidenceDir);
	if (resolved === evidence || resolved.startsWith(`${evidence}${path.sep}`)) {
		return { ok: false, reason: 'evidence' };
	}
	const tmp = path.resolve('/tmp');
	if (resolved === tmp || !resolved.startsWith(`${tmp}${path.sep}`)) {
		return { ok: false, reason: 'outside-tmp' };
	}
	return { ok: true, path: resolved };
}

export function localOrigin(port = DEFAULT_PORT) {
	return `http://127.0.0.1:${port}`;
}

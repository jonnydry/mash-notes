import { readFile } from 'node:fs/promises';
import { normalizePrecacheUrl, requiredBootPrecacheFiles } from './pwa-precache-policy.js';

const html = await readFile('build/index.html', 'utf8');
const manifest = JSON.parse(
	await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
);
const serviceWorker = await readFile('build/sw.js', 'utf8');

const precache = [
	...serviceWorker.matchAll(/\burl:(?:"([^"]+)"|`([^`]+)`),revision:(null|`[^`]*`|"[^"]*")/g)
].map((match) => ({
	url: normalizePrecacheUrl(match[1] ?? match[2]),
	revision: match[3]
}));
const precacheFiles = new Set(precache.map((entry) => entry.url));
const required = [...requiredBootPrecacheFiles(manifest, html)].sort();
const missing = required.filter((file) => !precacheFiles.has(file));
const revisedImmutable = precache.filter(
	(entry) => entry.url.startsWith('_app/immutable/') && entry.revision !== 'null'
);

console.log(`Boot files that must be precached (${required.length}):`);
for (const file of required) console.log(`  ${file}`);

const versionEntry = precache.find((entry) => entry.url === '_app/version.json');
if (!versionEntry) {
	console.error('Missing _app/version.json from the precache.');
	process.exitCode = 1;
} else if (!/^`[0-9a-f]{64}`$/.test(versionEntry.revision)) {
	console.error(
		`_app/version.json must use a content-hash revision, got ${versionEntry.revision}.`
	);
	process.exitCode = 1;
}
if (missing.length > 0) {
	console.error(`Missing from the precache (${missing.length}):`);
	for (const file of missing) console.error(`  ${file}`);
	process.exitCode = 1;
}
if (revisedImmutable.length > 0) {
	console.error('Hashed _app/immutable precache entries must use revision null:');
	for (const entry of revisedImmutable.slice(0, 8)) {
		console.error(`  ${entry.url} revision ${entry.revision}`);
	}
	process.exitCode = 1;
}
if (!process.exitCode) {
	const sample = precache.find((entry) => entry.url.startsWith('_app/immutable/'));
	console.log(
		`Boot precache check passed. Sample immutable entry: url ${sample?.url} revision ${sample?.revision}. _app/version.json revision ${versionEntry?.revision}.`
	);
}

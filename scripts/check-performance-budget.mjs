import { readFile, stat } from 'node:fs/promises';
import {
	collectInitialManifestFiles,
	collectInitialManifestKeys,
	isExcludedFromPrecache,
	normalizePrecacheUrl
} from './pwa-precache-policy.js';

const clientRoot = '.svelte-kit/output/client';
const manifestPath = `${clientRoot}/.vite/manifest.json`;
const deferredInitialEntryNames = new Set([
	'pdf',
	'sequence-pdf',
	'PdfReader',
	'board-image-export',
	'gifuct-js',
	'image-headers',
	'DocxReader',
	'HtmlReader',
	'SettingsPanel',
	'ShortcutsModal',
	'SpacesOverview',
	'SessionPanel',
	'FinishPanel',
	'finish-session-ui',
	'ExportSheet',
	'presentation-export',
	'presentation-pdf',
	'presentation-docx',
	'PasteChoiceDialog',
	'GifExplodeDialog',
	'sync-file'
]);
const budgets = {
	// Export scope handoff is core shell behavior; PDF/DOCX builders and the sheet stay deferred.
	javascript: 652 * 1024,
	// Keep core canvas chrome tight; presentation-preview CSS is measured only after its lazy load.
	css: 140 * 1024,
	fonts: 120 * 1024,
	fontFiles: 5,
	// Install/update cost: the shell, initial graph, core fonts, and brand chrome only.
	precache: 2 * 1024 * 1024
};

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const byName = new Map(
	Object.entries(manifest)
		.filter(([, entry]) => entry.name)
		.map(([key, entry]) => [entry.name, { key, ...entry }])
);
const initialKeys = collectInitialManifestKeys(manifest);
const initialFiles = collectInitialManifestFiles(manifest);

async function totalBytes(files) {
	let total = 0;
	for (const file of files) total += (await stat(`${clientRoot}/${file}`)).size;
	return total;
}

const jsFiles = [...initialFiles].filter((file) => file.endsWith('.js'));
const cssFiles = [...initialFiles].filter((file) => file.endsWith('.css'));
const fontFiles = [...initialFiles].filter((file) => /\.woff2?$/.test(file));
const [javascript, css, fonts] = await Promise.all([
	totalBytes(jsFiles),
	totalBytes(cssFiles),
	totalBytes(fontFiles)
]);

const errors = [];
if (javascript > budgets.javascript) {
	errors.push(`Initial JavaScript is ${format(javascript)} (budget ${format(budgets.javascript)})`);
}
if (css > budgets.css) {
	errors.push(`Initial CSS is ${format(css)} (budget ${format(budgets.css)})`);
}
if (fonts > budgets.fonts) {
	errors.push(`Initial fonts are ${format(fonts)} (budget ${format(budgets.fonts)})`);
}
if (fontFiles.length > budgets.fontFiles) {
	errors.push(`Initial load has ${fontFiles.length} font files (budget ${budgets.fontFiles})`);
}

for (const name of deferredInitialEntryNames) {
	const entry = byName.get(name);
	// Required deferred tooling must exist; chrome/optional names only fail if leaked.
	if (!entry) {
		if (['pdf', 'sequence-pdf', 'PdfReader', 'board-image-export'].includes(name)) {
			errors.push(`Deferred entry ${name} is missing from the build manifest`);
		}
		continue;
	}
	if (initialKeys.has(entry.key)) errors.push(`${name} leaked into the initial JavaScript graph`);
}

const serviceWorker = await readFile('build/sw.js', 'utf8');
const listedPrecacheFiles = [...serviceWorker.matchAll(/\burl:"([^"]+)"/g)].map((match) =>
	normalizePrecacheUrl(match[1])
);
const precacheFiles = [...new Set(listedPrecacheFiles)];
let precache = 0;
if (precacheFiles.length === 0) errors.push('Could not read the generated PWA precache manifest');
if (!precacheFiles.includes('index.html')) errors.push('PWA precache is missing the offline shell');
const duplicatePrecacheFiles = new Set(
	listedPrecacheFiles.filter((file, index) => listedPrecacheFiles.indexOf(file) !== index)
);
for (const file of duplicatePrecacheFiles) errors.push(`PWA precache lists ${file} more than once`);
for (const file of precacheFiles) {
	if (isExcludedFromPrecache(file)) errors.push(`${file} leaked into the PWA precache`);
	if (file.startsWith('_app/immutable/') && !initialFiles.has(file)) {
		errors.push(`${file} is not in the initial graph but leaked into the PWA precache`);
	}
	try {
		precache += (await stat(`build/${file}`)).size;
	} catch {
		errors.push(`PWA precache references missing build file ${file}`);
	}
}
if (precache > budgets.precache) {
	errors.push(`PWA precache is ${format(precache)} (budget ${format(budgets.precache)})`);
}

console.log(`Initial JavaScript  ${format(javascript)} / ${format(budgets.javascript)}`);
console.log(`Initial CSS         ${format(css)} / ${format(budgets.css)}`);
console.log(
	`Initial fonts       ${format(fonts)} / ${format(budgets.fonts)} (${fontFiles.length} files)`
);
console.log(
	`PWA precache        ${format(precache)} / ${format(budgets.precache)} (${precacheFiles.length} files)`
);
console.log('Deferred features   excluded from the initial graph and PWA precache');

if (errors.length) {
	console.error(`\nPerformance budget failed:\n- ${errors.join('\n- ')}`);
	process.exitCode = 1;
}

function format(bytes) {
	return `${(bytes / 1024).toFixed(1)} KiB`;
}

import { readFile, stat } from 'node:fs/promises';

const clientRoot = '.svelte-kit/output/client';
const manifestPath = `${clientRoot}/.vite/manifest.json`;
const initialEntryNames = new Set(['entry/start', 'entry/app', 'nodes/0', 'nodes/2']);
const deferredPrecacheEntryNames = new Set([
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
	'PasteChoiceDialog',
	'GifExplodeDialog',
	'sync-file'
]);
const deferredInitialEntryNames = deferredPrecacheEntryNames;
const budgets = {
	// Page orchestrator + canvas still dominate; deferred PDF/GIF stay out of graph.
	javascript: 630 * 1024,
	// Layout tokens + board chrome CSS; suite fonts are budgeted separately.
	css: 130 * 1024,
	fonts: 120 * 1024,
	fontFiles: 5
};

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const byName = new Map(
	Object.entries(manifest)
		.filter(([, entry]) => entry.name)
		.map(([key, entry]) => [entry.name, { key, ...entry }])
);
const initialKeys = new Set();

function visit(key) {
	if (initialKeys.has(key)) return;
	const entry = manifest[key];
	if (!entry) throw new Error(`Build manifest is missing imported entry ${key}`);
	initialKeys.add(key);
	for (const importedKey of entry.imports ?? []) visit(importedKey);
}

for (const name of initialEntryNames) {
	const entry = byName.get(name);
	if (!entry) throw new Error(`Build manifest is missing initial entry ${name}`);
	visit(entry.key);
}

const initialFiles = new Set();
for (const key of initialKeys) {
	const entry = manifest[key];
	initialFiles.add(entry.file);
	for (const file of entry.css ?? []) initialFiles.add(file);
	for (const file of entry.assets ?? []) initialFiles.add(file);
}

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
for (const name of deferredPrecacheEntryNames) {
	const entry = byName.get(name);
	if (!entry) continue;
	for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
		if (serviceWorker.includes(file)) errors.push(`${file} leaked into the PWA precache`);
	}
}

console.log(`Initial JavaScript  ${format(javascript)} / ${format(budgets.javascript)}`);
console.log(`Initial CSS         ${format(css)} / ${format(budgets.css)}`);
console.log(
	`Initial fonts       ${format(fonts)} / ${format(budgets.fonts)} (${fontFiles.length} files)`
);
console.log('Deferred features   excluded from initial graph and PWA precache');

if (errors.length) {
	console.error(`\nPerformance budget failed:\n- ${errors.join('\n- ')}`);
	process.exitCode = 1;
}

function format(bytes) {
	return `${(bytes / 1024).toFixed(1)} KiB`;
}

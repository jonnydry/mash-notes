import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

const manifest = JSON.parse(
	readFileSync('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
) as Record<string, { name?: string; file: string; css?: string[]; assets?: string[] }>;
const deferredFeatureFiles = new Set(
	Object.values(manifest)
		.filter((entry) =>
			[
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
				'GifExplodeDialog'
			].includes(entry.name ?? '')
		)
		.flatMap((entry) => [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])])
		.map((file) => file.split('/').at(-1))
);

test('keeps deferred export tooling out of the initial browser load', async ({ page }) => {
	await wipeIndexedDb(page);

	const loadedFiles = await page.evaluate(() =>
		performance
			.getEntriesByType('resource')
			.map((entry) => new URL(entry.name).pathname.split('/').at(-1))
	);
	const unexpected = loadedFiles.filter((file) => file && deferredFeatureFiles.has(file));

	expect(unexpected).toEqual([]);
});

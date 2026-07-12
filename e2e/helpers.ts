import { expect, type Page } from '@playwright/test';

/** Unregister PWA SW + wipe IndexedDB so each e2e starts from a clean vault. */
export async function wipeIndexedDb(page: Page) {
	await page.goto('/');
	await page.evaluate(async () => {
		const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
		await Promise.all(regs.map((r) => r.unregister()));
		const keys = (await caches?.keys?.()) ?? [];
		await Promise.all(keys.map((k) => caches.delete(k)));
		const dbs = (await indexedDB.databases?.()) ?? [];
		await Promise.all(
			dbs.map(
				(db) =>
					new Promise<void>((resolve) => {
						if (!db.name) {
							resolve();
							return;
						}
						const req = indexedDB.deleteDatabase(db.name);
						req.onsuccess = () => resolve();
						req.onerror = () => resolve();
						req.onblocked = () => resolve();
					})
			)
		);
		try {
			localStorage.removeItem('mash.openSpaces');
			localStorage.removeItem('mash.syncHygiene');
			localStorage.removeItem('mash.storagePersistencePrompted');
		} catch {
			/* ignore */
		}
	});
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	// Wait for initial loadNotes (seed welcome notes) so later imports aren't raced.
	await page.getByRole('button', { name: 'Desk' }).click();
	const peel = page.getByRole('complementary', { name: 'Note scanner' });
	await expect(peel.getByText('A quick hello from Scoop')).toBeVisible({
		timeout: 15_000
	});
}

/** New note opens in the stage editor (primary surface). */
export async function createNamedNote(page: Page, title: string, body: string) {
	await page.getByRole('button', { name: 'New note' }).click();
	const stage = page.locator('.mash-editor-stage.is-open, .mash-editor-pane').first();
	await expect(stage).toBeVisible({ timeout: 10_000 });
	const titleInput = page.locator('.mash-editor-pane-titlebar input').first();
	await expect(titleInput).toBeVisible({ timeout: 10_000 });
	await titleInput.fill(title);
	const bodyEl = page.locator('textarea.mash-sticky-body').first();
	await expect(bodyEl).toBeVisible();
	await bodyEl.fill(body);
	// Blur so debounced sticky saves flush before the next action.
	await bodyEl.blur();
	await page.waitForTimeout(500);
	await page.getByRole('button', { name: 'Collapse to canvas' }).click();
	await expect(page.getByRole('group', { name: title })).toBeVisible({ timeout: 5_000 });
	await page.waitForTimeout(400);
}

/** Open a note from the peel into the stage editor. */
export async function openNoteInStage(page: Page, title: string) {
	await page.getByRole('button', { name: 'Desk' }).click();
	const peel = page.getByRole('complementary', { name: 'Note scanner' });
	await expect(peel).toBeVisible();
	const row = peel.getByRole('option').filter({ hasText: title });
	await row.dblclick();
	await expect(page.locator('.mash-editor-pane-titlebar input').first()).toBeVisible({
		timeout: 10_000
	});
	await expect(page.locator('textarea.mash-sticky-body').first()).toBeVisible();
	// Unpinned Desk peel dismisses when the stage opens so it doesn't cover the editor.
	await expect(peel).toBeHidden({ timeout: 5_000 });
}

export function modKey() {
	return process.platform === 'darwin' ? 'Meta' : 'Control';
}

export async function openPalette(page: Page, query: string) {
	await page.keyboard.press(`${modKey()}+k`);
	const palette = page.getByPlaceholder('Type a command…');
	await expect(palette).toBeVisible();
	await palette.fill(query);
}

export async function selectNotesInPeel(page: Page, titles: string[]) {
	await page.getByRole('button', { name: 'Desk' }).click();
	const peel = page.getByRole('complementary', { name: 'Note scanner' });
	await expect(peel).toBeVisible();
	for (let i = 0; i < titles.length; i++) {
		const btn = peel.getByRole('option').filter({ hasText: titles[i] }).getByRole('button').nth(1);
		if (i === 0) await btn.click();
		else await btn.click({ modifiers: [modKey()] });
	}
	await expect(page.getByText(`${titles.length} selected`)).toBeVisible();
}

/** Confirm the selection-bar mash dialog. */
export async function confirmMashDialog(page: Page) {
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Mash these notes?' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Mash', exact: true }).click();
}

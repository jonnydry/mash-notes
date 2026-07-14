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
			localStorage.removeItem('mash.workspaceBackupRecord');
			// Suppress the post-Keep persistence confirm so Finish/desks e2e aren't blocked
			localStorage.setItem('mash.storagePersistencePrompted', '1');
		} catch {
			/* ignore */
		}
	});
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	// Wait for initial loadNotes (seed welcome notes) so later imports aren't raced.
	await page.getByRole('button', { name: 'Desk', exact: true }).click();
	const peel = page.getByRole('complementary', { name: 'Ingredients' });
	await expect(peel.getByText("Hi — I'm Scoop")).toBeVisible({
		timeout: 15_000
	});
}

/** New note expands on the canvas for quick entry. */
export async function createNamedNote(page: Page, title: string, body: string) {
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	await page.getByRole('button', { name: 'New note' }).click();
	const card = page
		.locator('[data-canvas-card]')
		.filter({ has: page.locator('textarea.mash-sticky-body') })
		.first();
	await expect(card).toBeVisible({ timeout: 10_000 });
	const titleInput = card.locator('input[type="text"]').first();
	await expect(titleInput).toBeVisible({ timeout: 10_000 });
	await titleInput.fill(title);
	const bodyEl = card.locator('textarea.mash-sticky-body');
	await expect(bodyEl).toBeVisible();
	await bodyEl.fill(body);
	// Blur so debounced sticky saves flush before the next action.
	await bodyEl.blur();
	await page.waitForTimeout(500);
	await card.getByRole('button', { name: 'Collapse sticky' }).click();
	await expect(page.getByRole('group', { name: title })).toBeVisible({ timeout: 5_000 });
	await page.waitForTimeout(400);
}

/** Open a note from the peel into the stage editor. */
export async function openNoteInStage(page: Page, title: string) {
	await page
		.getByRole('navigation', { name: 'Mash dock' })
		.getByRole('button', { name: 'Desk', exact: true })
		.click();
	const peel = page.getByRole('complementary', { name: 'Ingredients' });
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
	await page
		.getByRole('navigation', { name: 'Mash dock' })
		.getByRole('button', { name: 'Desk', exact: true })
		.click();
	const peel = page.getByRole('complementary', { name: 'Ingredients' });
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

/** Dismiss confirm / storage-protection dialogs that block the header Finish button. */
export async function dismissBlockingDialogs(page: Page) {
	const alertdialog = page.getByRole('alertdialog');
	if (await alertdialog.isVisible().catch(() => false)) {
		const cancel = alertdialog.getByRole('button', { name: /Cancel|Close|Not now|Dismiss/i });
		if (
			await cancel
				.first()
				.isVisible()
				.catch(() => false)
		) {
			await cancel.first().click();
		} else {
			await page.keyboard.press('Escape');
		}
		await expect(alertdialog).toBeHidden({ timeout: 5_000 });
	}
	const backdrop = page.locator('.mash-confirm-backdrop');
	if (await backdrop.isVisible().catch(() => false)) {
		// Click outside panel (backdrop handler cancels) or Escape
		await backdrop.click({ position: { x: 4, y: 4 }, force: true }).catch(() => {});
		await page.keyboard.press('Escape');
		await backdrop.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
	}
}

/**
 * Open the desks panel. Header is Finish-only; desks live under dock More (mobile)
 * or Finish → View all desks (desktop).
 */
export async function openDesksPanel(page: Page) {
	await dismissBlockingDialogs(page);
	const more = page.getByRole('button', { name: 'More navigation' });
	if (await more.isVisible()) {
		await more.click();
		await page.locator('.mash-dock-more-menu').getByRole('menuitem', { name: 'Desks' }).click();
	} else {
		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		await expect(finish).toBeVisible({ timeout: 10_000 });
		await finish.getByRole('button', { name: 'View all desks' }).click();
	}
	await expect(page.getByRole('dialog', { name: 'Your desks' })).toBeVisible({
		timeout: 10_000
	});
}

/** Redo lives under View after quiet board chrome (not a primary board chip). */
export async function redoFromViewMenu(page: Page) {
	// Stage can cover board chrome after mash — collapse first when open.
	const collapse = page.getByRole('button', { name: 'Collapse to canvas' });
	if (await collapse.isVisible().catch(() => false)) {
		await collapse.click();
	}
	await page.getByTestId('board-view-toggle').click();
	await page.getByTestId('board-view-menu').getByRole('menuitem', { name: 'Redo layout' }).click();
}

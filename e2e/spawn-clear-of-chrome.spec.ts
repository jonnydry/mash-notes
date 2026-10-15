import { expect, test, type Locator, type Page } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box) {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Same nodes placement measures. The toast node is only present while a toast is showing. */
async function visibleChrome(page: Page) {
	return page.evaluate(() => {
		const boxes: Array<Box & { selector: string }> = [];
		for (const el of document.querySelectorAll('[data-floating-chrome]')) {
			const box = el.getBoundingClientRect();
			if (box.width <= 0 || box.height <= 0) continue;
			const label = el.classList.contains('mash-dock-slot')
				? '.mash-dock-slot'
				: el.classList.contains('mash-canvas-title-chip')
					? '.mash-canvas-title-chip'
					: el.classList.contains('mash-canvas-chrome-top')
						? '.mash-canvas-chrome-top'
						: el.classList.contains('mash-canvas-chrome-pan')
							? '.mash-canvas-chrome-pan'
							: el.classList.contains('mash-selection-bar')
								? '.mash-selection-bar'
								: el.getAttribute('data-testid') === 'action-status'
									? '[data-testid="action-status"]'
									: el.tagName.toLowerCase();
			boxes.push({
				selector: label,
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height
			});
		}
		return boxes;
	});
}

/**
 * Every position:fixed or position:absolute element in the canvas overlay must
 * carry data-floating-chrome. Cards and the panning world are the desk, not chrome.
 * A piece inside an already-marked control belongs to that control.
 * The toast is fixed outside the stage and only exists while it is visible.
 */
async function unmarkedOverlayChrome(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const overlay = document.querySelector('[data-canvas-overlay]');
		if (!overlay) return ['missing [data-canvas-overlay]'];
		const roots: Element[] = [overlay];
		const toast = document.querySelector('[data-testid="action-status"]');
		if (toast && !overlay.contains(toast)) roots.push(toast);
		const missing: string[] = [];
		const seen = new Set<Element>();
		for (const root of roots) {
			const elements = root === overlay ? [root, ...root.querySelectorAll('*')] : [root];
			for (const el of elements) {
				if (!(el instanceof HTMLElement) || seen.has(el)) continue;
				seen.add(el);
				if (el.closest('[data-canvas-card]')) continue;
				if (el.closest('[data-canvas-world]')) continue;
				const position = getComputedStyle(el).position;
				if (position !== 'fixed' && position !== 'absolute') continue;
				if (el.hasAttribute('data-floating-chrome')) continue;
				if (el.closest('[data-floating-chrome]')) continue;
				const testid = el.getAttribute('data-testid');
				const cls =
					typeof el.className === 'string'
						? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
						: '';
				missing.push(
					`${el.tagName.toLowerCase()}${testid ? `[data-testid="${testid}"]` : ''}${cls ? `.${cls}` : ''}`
				);
			}
		}
		return missing;
	});
}

async function layoutBox(locator: Locator): Promise<Box> {
	await expect(locator).toBeVisible();
	return locator.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	});
}

async function assertHeaderClearsChrome(page: Page, header: Locator, collapse: Locator) {
	const headerBox = await layoutBox(header);
	const collapseBox = await layoutBox(collapse);
	expect(headerBox.width).toBeGreaterThan(0);
	expect(collapseBox.width).toBeGreaterThan(0);
	const chrome = await visibleChrome(page);
	expect(chrome.some((box) => box.selector === '.mash-canvas-chrome-top')).toBe(true);
	expect(chrome.some((box) => box.selector === '.mash-canvas-chrome-pan')).toBe(true);
	expect(chrome.some((box) => box.selector === '.mash-selection-bar')).toBe(true);
	expect(chrome.some((box) => box.selector === '.mash-dock-slot')).toBe(true);
	expect(chrome.some((box) => box.selector === '.mash-canvas-title-chip')).toBe(true);
	for (const obstacle of chrome) {
		expect(intersects(headerBox, obstacle), obstacle.selector).toBe(false);
		expect(intersects(collapseBox, obstacle), obstacle.selector).toBe(false);
	}
}

test('new cards stay clear of floating chrome on a busy desk', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();

	const world = page.getByRole('application', { name: 'Mash canvas' }).locator('> div').first();
	const transformBefore = await world.evaluate(
		(element) => (element as HTMLElement).style.transform
	);
	const newNote = page.getByRole('button', { name: 'New note' });

	const expanded = page.locator('[data-canvas-card][data-expanded="true"]');
	const toast = page.getByTestId('action-status');

	async function placeAndCheck(expectToast: boolean) {
		const previousId = (await expanded.count())
			? await expanded.getAttribute('data-note-id')
			: null;
		await newNote.click();
		await expect
			.poll(async () => expanded.getAttribute('data-note-id'), { timeout: 10_000 })
			.not.toBe(previousId);
		await expect(expanded).toHaveCount(1, { timeout: 10_000 });
		await expect(expanded).toHaveCSS('width', '280px', { timeout: 10_000 });
		await expect(toast).toBeVisible();
		if (expectToast) await expect(toast).toContainText('Dropped');
		await assertHeaderClearsChrome(
			page,
			expanded.locator('.mash-card-header'),
			expanded.getByRole('button', { name: 'Collapse sticky' })
		);
	}

	await placeAndCheck(true);
	for (let i = 0; i < 17; i++) await placeAndCheck(false);

	expect(await world.evaluate((element) => (element as HTMLElement).style.transform)).toBe(
		transformBefore
	);
	expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);
	expect(await unmarkedOverlayChrome(page)).toEqual([]);
});

test('floating controls over the canvas carry data-floating-chrome', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.locator('[data-canvas-card][data-expanded="true"]')).toHaveCount(1);
	await expect(page.getByTestId('action-status')).toBeVisible();
	expect(await unmarkedOverlayChrome(page)).toEqual([]);
	const chrome = await visibleChrome(page);
	for (const selector of [
		'.mash-canvas-chrome-top',
		'.mash-canvas-chrome-pan',
		'.mash-selection-bar',
		'.mash-dock-slot',
		'.mash-canvas-title-chip',
		'[data-testid="action-status"]'
	]) {
		expect(chrome.some((box) => box.selector === selector)).toBe(true);
	}
});

/** Stored top-lefts, including cards the board has culled off screen. */
async function storedTopLefts(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('mashdb-notes-v1');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const items = await new Promise<Array<{ x: number; y: number }>>((resolve, reject) => {
				const request = db
					.transaction('canvasItems', 'readonly')
					.objectStore('canvasItems')
					.getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return items.map((item) => `${item.x}|${item.y}`);
		} finally {
			db.close();
		}
	});
}

async function distinctTopLefts(page: Page, count: number) {
	const world = page.getByRole('application', { name: 'Mash canvas' }).locator('> div').first();
	const transformBefore = await world.evaluate(
		(element) => (element as HTMLElement).style.transform
	);
	const newNote = page.getByRole('button', { name: 'New note' });
	const expanded = page.locator('[data-canvas-card][data-expanded="true"]');
	for (let i = 0; i < count; i++) {
		const previousId = (await expanded.count())
			? await expanded.getAttribute('data-note-id')
			: null;
		await newNote.click();
		await expect
			.poll(async () => expanded.getAttribute('data-note-id'), { timeout: 10_000 })
			.not.toBe(previousId);
	}
	let spots: string[] = [];
	await expect
		.poll(
			async () => {
				spots = await storedTopLefts(page);
				return spots.length;
			},
			{ timeout: 15_000 }
		)
		.toBeGreaterThanOrEqual(count);
	const distinct = new Set(spots);
	console.log(`distinct top-lefts ${spots.length} cards, ${distinct.size} unique`);
	expect(distinct.size, spots.join(', ')).toBe(spots.length);
	expect(await world.evaluate((element) => (element as HTMLElement).style.transform)).toBe(
		transformBefore
	);
	expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);
	return distinct.size;
}

test('new notes keep distinct top-lefts at 1280×800', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	const distinct = await distinctTopLefts(page, 35);
	test.info().annotations.push({
		type: 'distinct-top-lefts',
		description: `1280x800: ${distinct}`
	});
});

test('new notes keep distinct top-lefts at 1000×700', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1000, height: 700 });
	await wipeIndexedDb(page);
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	const distinct = await distinctTopLefts(page, 35);
	test.info().annotations.push({
		type: 'distinct-top-lefts',
		description: `1000x700: ${distinct}`
	});
});

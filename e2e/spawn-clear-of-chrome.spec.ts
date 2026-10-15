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
				: el.classList.contains('mash-peel-slot')
					? '.mash-peel-slot'
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

type FloatingOffender = {
	selector: string;
	zIndex: string;
	rect: string;
};

/**
 * Controls that paint above the cards and overlap the canvas.
 * A container with pointer-events: none still counts when it or any descendant
 * takes clicks (the top chrome is pointer-events: none and its Undo button is not).
 * A position:fixed layer counts even when nothing inside it takes a click: the
 * toast is pointer-events: none and has no child control, and placement only
 * sees it while it is showing.
 * The element or an ancestor must carry data-floating-chrome. Scans the whole
 * document, because the Ingredients and Settings panels are mounted outside
 * the canvas overlay.
 */
async function unmarkedFloatingChrome(page: Page): Promise<FloatingOffender[]> {
	return page.evaluate(() => {
		const canvas = document.querySelector('[role="application"][aria-label="Mash canvas"]');
		const cardLayer = document.querySelector('[data-canvas-world]');
		if (!(canvas instanceof HTMLElement) || !(cardLayer instanceof HTMLElement)) {
			return [{ selector: 'missing canvas', zIndex: 'auto', rect: '0,0 0x0' }];
		}
		const canvasBox = canvas.getBoundingClientRect();

		function chain(node: Element): Element[] {
			const nodes: Element[] = [];
			let current: Element | null = node;
			while (current) {
				nodes.push(current);
				current = current.parentElement;
			}
			nodes.reverse();
			return nodes;
		}

		function level(style: CSSStyleDeclaration): number {
			if (style.position === 'static' || style.zIndex === 'auto') return 0;
			const value = Number.parseInt(style.zIndex, 10);
			return Number.isFinite(value) ? value : 0;
		}

		/** Positive when `candidate` paints above the card layer. */
		function stacksAboveCardLayer(candidate: HTMLElement): boolean {
			if (candidate === cardLayer || cardLayer.contains(candidate)) return false;
			const candidateChain = chain(candidate);
			const layerChain = chain(cardLayer);
			let shared = 0;
			while (
				shared < candidateChain.length &&
				shared < layerChain.length &&
				candidateChain[shared] === layerChain[shared]
			) {
				shared += 1;
			}
			const candidateRoot = candidateChain[shared];
			const layerRoot = layerChain[shared];
			if (!(candidateRoot instanceof HTMLElement) || !(layerRoot instanceof HTMLElement))
				return false;
			const candidateLevel = level(getComputedStyle(candidateRoot));
			const layerLevel = level(getComputedStyle(layerRoot));
			if (candidateLevel !== layerLevel) return candidateLevel > layerLevel;
			const order = candidateRoot.compareDocumentPosition(layerRoot);
			return (order & Node.DOCUMENT_POSITION_FOLLOWING) === 0;
		}

		function intersectsCanvas(rect: DOMRect): boolean {
			return (
				rect.width > 0 &&
				rect.height > 0 &&
				rect.left < canvasBox.right &&
				rect.right > canvasBox.left &&
				rect.top < canvasBox.bottom &&
				rect.bottom > canvasBox.top
			);
		}

		function takesClicks(el: HTMLElement): boolean {
			const computed = getComputedStyle(el);
			if (computed.pointerEvents === 'none') return false;
			if (computed.visibility === 'hidden' || computed.display === 'none') return false;
			return true;
		}

		/** The node itself, or a descendant such as an Undo button inside a pass-through container. */
		function subtreeTakesClicks(el: HTMLElement): boolean {
			if (takesClicks(el)) return true;
			for (const node of el.querySelectorAll('*')) {
				if (node instanceof HTMLElement && takesClicks(node)) return true;
			}
			return false;
		}

		function selectorFor(el: HTMLElement): string {
			if (el.id) return `#${CSS.escape(el.id)}`;
			const testid = el.getAttribute('data-testid');
			if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
			const classes = [...el.classList]
				.slice(0, 3)
				.map((name) => `.${CSS.escape(name)}`)
				.join('');
			return `${el.tagName.toLowerCase()}${classes}`;
		}

		const offenders: FloatingOffender[] = [];
		for (const node of document.querySelectorAll('*')) {
			if (!(node instanceof HTMLElement)) continue;
			if (node.closest('[data-floating-chrome]')) continue;
			const style = getComputedStyle(node);
			if (
				style.position !== 'absolute' &&
				style.position !== 'fixed' &&
				style.position !== 'sticky'
			) {
				continue;
			}
			if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
				continue;
			const rect = node.getBoundingClientRect();
			if (!intersectsCanvas(rect)) continue;
			if (!stacksAboveCardLayer(node)) continue;
			// Fixed layers such as the toast sit over the cards even with pointer-events: none.
			if (!subtreeTakesClicks(node) && style.position !== 'fixed') continue;
			offenders.push({
				selector: selectorFor(node),
				zIndex: style.zIndex,
				rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
			});
		}
		return offenders;
	});
}

function formatOffenders(offenders: FloatingOffender[]): string {
	return offenders
		.map((offender) => `${offender.selector} z-index:${offender.zIndex} rect:${offender.rect}`)
		.join('\n');
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
	const offenders = await unmarkedFloatingChrome(page);
	expect(offenders, formatOffenders(offenders)).toEqual([]);
});

async function chromeOverlapCount(page: Page): Promise<{ cards: number; overlaps: number }> {
	return page.evaluate(() => {
		function hits(a: DOMRect, b: DOMRect) {
			return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
		}
		const chrome = [...document.querySelectorAll('[data-floating-chrome]')]
			.map((el) => el.getBoundingClientRect())
			.filter((box) => box.width > 0 && box.height > 0);
		const cards = [...document.querySelectorAll('[data-canvas-card]')].filter(
			(el): el is HTMLElement => el instanceof HTMLElement
		);
		let overlaps = 0;
		for (const card of cards) {
			const box = card.getBoundingClientRect();
			if (box.width <= 0 || box.height <= 0) continue;
			if (chrome.some((obstacle) => hits(box, obstacle))) overlaps += 1;
		}
		return { cards: cards.length, overlaps };
	});
}

/** Last expanded card collapses, then bump-restore finishes. One neighbour can share a top-left until then. */
async function distinctAfterCollapse(page: Page, count: number) {
	await page.getByRole('button', { name: 'Collapse sticky' }).click();
	await expect(page.locator('[data-canvas-card][data-expanded="true"]')).toHaveCount(0, {
		timeout: 10_000
	});
	let spots: string[] = [];
	let previous = '';
	let stable = 0;
	await expect
		.poll(
			async () => {
				spots = await storedTopLefts(page);
				const key = spots.slice().sort().join(';');
				if (key === previous && spots.length >= count) stable += 1;
				else stable = 0;
				previous = key;
				return stable >= 2 && new Set(spots).size === spots.length;
			},
			{ timeout: 15_000, intervals: [200, 300, 400] }
		)
		.toBe(true);
	return { total: spots.length, distinct: new Set(spots).size };
}

async function busyDeskWithIngredientsOpen(
	page: Page,
	width: number,
	height: number,
	count: number
) {
	await page.setViewportSize({ width, height });
	await wipeIndexedDb(page);
	await expect(page.getByRole('complementary', { name: 'Ingredients' })).toBeVisible();
	const world = page.getByRole('application', { name: 'Mash canvas' }).locator('> div').first();
	const transformBefore = await world.evaluate(
		(element) => (element as HTMLElement).style.transform
	);
	const newNote = page.getByRole('button', { name: 'New note' });
	const expanded = page.locator('[data-canvas-card][data-expanded="true"]');
	const toast = page.getByTestId('action-status');
	for (let i = 0; i < count; i++) {
		const previousId = (await expanded.count())
			? await expanded.getAttribute('data-note-id')
			: null;
		await newNote.click();
		await expect
			.poll(async () => expanded.getAttribute('data-note-id'), { timeout: 10_000 })
			.not.toBe(previousId);
		await expect(expanded).toHaveCSS('width', '280px', { timeout: 10_000 });
		await expect(toast).toBeVisible();
		await assertHeaderClearsChrome(
			page,
			expanded.locator('.mash-card-header'),
			expanded.getByRole('button', { name: 'Collapse sticky' })
		);
		const chrome = await visibleChrome(page);
		expect(chrome.some((box) => box.selector === '.mash-peel-slot')).toBe(true);
		const cardBox = await layoutBox(expanded);
		for (const obstacle of chrome) {
			expect(intersects(cardBox, obstacle), obstacle.selector).toBe(false);
		}
	}
	const settled = await distinctAfterCollapse(page, count);
	const overlap = await chromeOverlapCount(page);
	console.log(
		`ingredients-open ${width}x${height}: overlaps ${overlap.overlaps} of ${overlap.cards}, distinct ${settled.distinct} of ${settled.total}`
	);
	expect(overlap.overlaps).toBe(0);
	expect(settled.distinct).toBe(settled.total);
	expect(settled.total).toBeGreaterThanOrEqual(count);
	expect(await world.evaluate((element) => (element as HTMLElement).style.transform)).toBe(
		transformBefore
	);
	expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);
	return { overlaps: overlap.overlaps, cards: overlap.cards, ...settled };
}

test('new cards stay clear of an open Ingredients panel at 1280×800', async ({ page }) => {
	test.setTimeout(180_000);
	const measured = await busyDeskWithIngredientsOpen(page, 1280, 800, 35);
	test.info().annotations.push({
		type: 'ingredients-open',
		description: `1280x800 overlaps ${measured.overlaps} of ${measured.cards}, distinct ${measured.distinct} of ${measured.total}`
	});
});

test('new cards stay clear of an open Ingredients panel at 1000×700', async ({ page }) => {
	test.setTimeout(180_000);
	const measured = await busyDeskWithIngredientsOpen(page, 1000, 700, 35);
	test.info().annotations.push({
		type: 'ingredients-open',
		description: `1000x700 overlaps ${measured.overlaps} of ${measured.cards}, distinct ${measured.distinct} of ${measured.total}`
	});
});

test('floating controls over the canvas carry data-floating-chrome', async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1280, height: 800 });

	async function raiseToast() {
		const toast = page.getByTestId('action-status');
		if (await toast.isVisible().catch(() => false)) return;
		await page.getByRole('button', { name: 'New note' }).click();
		await expect(toast).toBeVisible();
	}

	async function scan(state: string) {
		await raiseToast();
		const offenders = await unmarkedFloatingChrome(page);
		const detail = formatOffenders(offenders);
		if (detail) console.log(`${state}\n${detail}`);
		expect(offenders, `${state}\n${detail}`).toEqual([]);
	}

	await wipeIndexedDb(page);
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	await expect(page.locator('.mash-peel-slot')).toHaveCount(0);
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.locator('[data-canvas-card][data-expanded="true"]')).toHaveCount(1);
	await expect(page.getByTestId('action-status')).toBeVisible();
	await scan('no panel');

	await page.getByRole('button', { name: 'Desk', exact: true }).click();
	await expect(page.getByRole('complementary', { name: 'Ingredients' })).toBeVisible();
	await expect(page.locator('.mash-peel-slot')).toHaveCount(1);
	await scan('Ingredients open');

	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('complementary', { name: 'Settings' })).toBeVisible();
	await expect(page.locator('.mash-peel-slot')).toHaveCount(1);
	await scan('Settings open');

	const chrome = await visibleChrome(page);
	for (const selector of ['.mash-dock-slot', '.mash-peel-slot', '.mash-canvas-title-chip']) {
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

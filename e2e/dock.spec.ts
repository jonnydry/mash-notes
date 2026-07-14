import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('Dock motion', () => {
	test('keeps hit targets stable while the icons magnify and moves one active plate', async ({
		page
	}) => {
		await wipeIndexedDb(page);
		const dock = page.getByRole('navigation', { name: 'Mash dock' });
		const desk = dock.getByRole('button', { name: 'Desk', exact: true });
		const pinned = dock.getByRole('button', { name: 'Pinned', exact: true });
		const newNote = dock.getByRole('button', { name: 'New note', exact: true });
		const search = dock.getByRole('button', { name: 'Search', exact: true });
		const plate = dock.locator('.mash-side-dock-active-plate');

		await expect(dock).toBeVisible();
		await expect(plate).toBeVisible();
		const before = await search.boundingBox();
		expect(before?.width).toBeGreaterThanOrEqual(44);
		expect(before?.height).toBeGreaterThanOrEqual(44);

		await search.hover();
		await expect(search.locator('.mash-side-dock-label')).toBeVisible();
		const after = await search.boundingBox();
		expect(after?.x).toBeCloseTo(before?.x ?? 0, 1);
		expect(after?.y).toBeCloseTo(before?.y ?? 0, 1);
		expect(after?.width).toBeCloseTo(before?.width ?? 0, 1);
		expect(after?.height).toBeCloseTo(before?.height ?? 0, 1);

		const deskBox = await desk.boundingBox();
		await expect.poll(async () => (await plate.boundingBox())?.y).toBeCloseTo(deskBox?.y ?? 0, 1);

		await pinned.click();
		await expect(pinned).toHaveAttribute('aria-pressed', 'true');
		const pinnedBox = await pinned.boundingBox();
		await expect.poll(async () => (await plate.boundingBox())?.y).toBeCloseTo(pinnedBox?.y ?? 0, 1);
		await expect(dock.locator('button[aria-pressed="true"]')).toHaveCount(1);

		for (const label of ['Folders', 'Tags', 'Linked', 'Settings']) {
			const button = dock.getByRole('button', { name: label, exact: true });
			await button.click();
			await expect(button).toHaveAttribute('aria-pressed', 'true');
			await expect(dock.locator('button[aria-pressed="true"]')).toHaveCount(1);
			const buttonBox = await button.boundingBox();
			await expect
				.poll(async () => (await plate.boundingBox())?.y)
				.toBeCloseTo(buttonBox?.y ?? 0, 1);
		}

		await newNote.click();
		await expect(newNote).toHaveClass(/is-confirming/);
		await expect(newNote).not.toHaveClass(/is-confirming/, { timeout: 1_000 });
	});
});

test.describe('Mobile dock motion', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('uses full-size touch targets and opens More from the dock', async ({ page }) => {
		await wipeIndexedDb(page);
		const dock = page.getByRole('navigation', { name: 'Mash dock' });
		const primaryButtons = dock.locator(':scope > button:visible');
		const boxes = await primaryButtons.evaluateAll((buttons) =>
			buttons.map((button) => {
				const rect = button.getBoundingClientRect();
				return { width: rect.width, height: rect.height };
			})
		);
		expect(boxes).not.toHaveLength(0);
		for (const box of boxes) {
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
		}

		await dock.getByRole('button', { name: 'More navigation' }).click();
		await expect(dock.getByRole('menu', { name: 'More navigation' })).toBeVisible();
	});
});

import { expect, test } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test.describe('Compact sticky opening', () => {
	test('uses the desk editor by default and maximizes only on explicit request', async ({
		page
	}) => {
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Compact note', 'A short note.');

		const card = page.getByRole('group', { name: 'Compact note' });
		await card.dblclick();
		await expect(card).toHaveAttribute('data-expanded', 'true');
		await expect(card).toHaveCSS('width', '280px');
		await expect(card).toHaveCSS('height', '220px');
		await expect(page.getByRole('region', { name: 'Note editor stage' })).toHaveCount(0);

		await card.getByRole('button', { name: 'Open large editor' }).click();
		const stage = page.getByRole('region', { name: 'Note editor stage' });
		await expect(stage).toBeVisible();
		await expect(stage.getByRole('region', { name: 'Compact note' })).toBeVisible();
		await stage.getByRole('button', { name: 'Close pane' }).click();

		await card.click();
		await card.press('Enter');
		await expect(card).toHaveAttribute('data-expanded', 'true');
		await expect(stage).toHaveCount(0);

		await card.getByRole('button', { name: 'Collapse sticky' }).click();
		const search = page.getByPlaceholder('Search notes to grab…');
		await search.fill('Compact note');
		await search.press('Enter');
		await expect(card).toHaveAttribute('data-expanded', 'true');
		await expect(stage).toHaveCount(0);
	});

	test('opens Ingredients on the desk and grows a long note once', async ({ page }) => {
		await wipeIndexedDb(page);
		const longBody = Array.from(
			{ length: 40 },
			(_, index) => `Line ${index + 1}: a useful piece of long-form working text.`
		).join('\n');
		await createNamedNote(page, 'Long working note', longBody);

		await page.getByRole('button', { name: 'Desk', exact: true }).click();
		const peel = page.getByRole('complementary', { name: 'Ingredients' });
		const row = peel.getByRole('option').filter({ hasText: 'Long working note' });
		await row.dblclick();

		const card = page.getByRole('group', { name: 'Long working note' });
		await expect(peel).toBeHidden();
		await expect(card).toHaveAttribute('data-expanded', 'true');
		await expect
			.poll(async () => {
				const box = await card.boundingBox();
				return box ? { width: Math.round(box.width), height: Math.round(box.height) } : null;
			})
			.toEqual({ width: 400, height: 480 });
		await expect(page.getByRole('region', { name: 'Note editor stage' })).toHaveCount(0);
	});
});

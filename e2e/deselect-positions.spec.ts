import { expect, test, type Locator, type Page } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

async function boardPosition(card: Locator) {
	return card.evaluate((element) => ({
		left: (element as HTMLElement).style.left,
		top: (element as HTMLElement).style.top
	}));
}

async function dragCard(page: Page, card: Locator, dx: number, dy: number) {
	const box = await card.boundingBox();
	expect(box).not.toBeNull();
	const startX = box!.x + 28;
	const startY = box!.y + 36;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
	await page.mouse.up();
	await page.waitForTimeout(400);
}

test('collapse puts a bumped neighbor back at its original position', async ({ page }) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	await createNamedNote(page, 'Anchor', 'Stays put');
	await createNamedNote(page, 'Neighbor', 'Gets bumped');

	const anchor = page.getByRole('group', { name: 'Anchor' });
	const neighbor = page.getByRole('group', { name: 'Neighbor' });
	const anchorBox = await anchor.boundingBox();
	const neighborBox = await neighbor.boundingBox();
	expect(anchorBox).not.toBeNull();
	expect(neighborBox).not.toBeNull();
	// Collapsed cards are 220px wide and expanded cards are 280px, so a 16px
	// gap overlaps only after expand and the neighbor has to move aside.
	await dragCard(
		page,
		neighbor,
		anchorBox!.x + anchorBox!.width + 16 - neighborBox!.x,
		anchorBox!.y - neighborBox!.y
	);

	const original = await boardPosition(neighbor);
	await anchor.dblclick();
	await expect(anchor).toHaveAttribute('data-expanded', 'true');
	await expect.poll(async () => (await boardPosition(neighbor)).left).not.toBe(original.left);

	const board = page.getByRole('application', { name: 'Mash canvas' });
	const point = await board.evaluate((element) => {
		const boardRect = element.getBoundingClientRect();
		const cards = [...document.querySelectorAll('[data-canvas-card]')].map((card) =>
			card.getBoundingClientRect()
		);
		for (let y = 12; y < boardRect.height - 12; y += 20) {
			for (let x = 12; x < boardRect.width - 12; x += 20) {
				const clientX = boardRect.left + x;
				const clientY = boardRect.top + y;
				const hitsCard = cards.some(
					(card) =>
						clientX >= card.left &&
						clientX <= card.right &&
						clientY >= card.top &&
						clientY <= card.bottom
				);
				if (!hitsCard) return { x, y };
			}
		}
		return null;
	});
	expect(point).not.toBeNull();
	await board.click({ position: point! });
	await expect(anchor).not.toHaveAttribute('data-expanded', 'true');
	await expect.poll(async () => boardPosition(neighbor)).toEqual(original);
});

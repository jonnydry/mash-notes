import { expect, test } from '@playwright/test';
import { createNamedNote, openDesksPanel, wipeIndexedDb } from './helpers';

test.describe('Modal focus and announcements', () => {
	test('traps and restores focus while announcing selection and lifecycle changes', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);
		const announcer = page.getByTestId('sr-announcer');

		// Desktop: Finish → View all desks; mobile: More → Desks.
		// Finish→desks reuses the dialog shell, so re-home focus for the trap check.
		await openDesksPanel(page);
		const desks = page.getByRole('dialog', { name: 'Your desks' });
		const closeDeskPanel = desks.getByRole('button', { name: 'Close desk panel' });
		await closeDeskPanel.focus();
		await expect(closeDeskPanel).toBeFocused();

		await page.keyboard.press('Shift+Tab');
		await expect(desks.getByRole('button', { name: 'Refresh' })).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(desks.locator('select')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(desks.getByRole('button', { name: 'Refresh' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(closeDeskPanel).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(desks).toBeHidden();

		await openDesksPanel(page);
		await desks.locator('select').selectOption('30');
		await expect(page.getByTestId('action-status')).toHaveText(
			'Scratch desks now clear after 30 days of inactivity'
		);
		await desks.getByRole('button', { name: 'New scratch desk' }).click();
		await expect(page.getByTestId('action-status')).toHaveText(
			'New scratch desk — clears after inactivity'
		);

		await createNamedNote(page, 'Announced note', 'Accessible selection feedback.');
		await expect(announcer).toHaveText('Announced note selected');
		await page.getByRole('button', { name: 'Clear selection' }).click();
		await expect(announcer).toHaveText('Selection cleared');

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		const clearNow = finish.getByRole('radio', { name: /Clear now/ });
		await clearNow.focus();
		await clearNow.press('Space');
		const finishAndClear = finish.getByRole('button', { name: 'Finish and clear' });
		await finishAndClear.click();
		const confirm = page.getByRole('alertdialog', { name: 'Clear this desk?' });
		await expect(confirm.getByRole('button', { name: 'Clear desk' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(confirm).toBeHidden();
		await expect(finishAndClear).toBeFocused();
	});
});

test.describe('Reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	test('collapses decorative animation and transition durations', async ({ page }) => {
		await wipeIndexedDb(page);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const durations = await page.locator('.mash-side-dock').evaluate((element) => {
			const style = getComputedStyle(element);
			const milliseconds = (value: string) =>
				value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
			return {
				reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
				animationName: style.animationName,
				transition: milliseconds(style.transitionDuration)
			};
		});
		expect(durations.reduced).toBe(true);
		expect(durations.animationName).toBe('none');
		expect(durations.transition).toBeLessThanOrEqual(0.02);
	});
});

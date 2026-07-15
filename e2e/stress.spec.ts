import { expect, test, type Page } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

const NOTE_COUNT = 5_000;
const CANVAS_CARD_COUNT = 160;
const CANVAS_ELEMENT_COUNT = 360;
const SEARCH_NEEDLE = 'zxqv-needle-4999';

async function seedMessyWorkspace(page: Page) {
	await page.goto('/robots.txt');
	await page.evaluate(
		async ({ noteCount, canvasCardCount, canvasElementCount, searchNeedle }) => {
			type SeedSession = {
				id: string;
				title: string;
				mode: 'scratch' | 'kept';
				status: 'active' | 'recovering';
				created: number;
				modified: number;
				lastMeaningfulActivityAt: number;
				expiresAt?: number;
				recoveryUntil?: number;
			};
			const requestResult = <T>(request: IDBRequest<T>) =>
				new Promise<T>((resolve, reject) => {
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			const transactionDone = (transaction: IDBTransaction) =>
				new Promise<void>((resolve, reject) => {
					transaction.oncomplete = () => resolve();
					transaction.onerror = () => reject(transaction.error);
					transaction.onabort = () => reject(transaction.error);
				});

			const database = await requestResult(indexedDB.open('mashdb-notes-v1'));
			const readTransaction = database.transaction(['sessions', 'canvases'], 'readonly');
			const sessions = (await requestResult(
				readTransaction.objectStore('sessions').getAll()
			)) as SeedSession[];
			const canvases = (await requestResult(
				readTransaction.objectStore('canvases').getAll()
			)) as Array<{ id: string; sessionId?: string; folder: string }>;
			await transactionDone(readTransaction);

			const storedSessionId = localStorage.getItem('mash.activeSessionId');
			const activeSessions = sessions
				.filter((candidate) => candidate.status === 'active')
				.sort((a, b) => b.modified - a.modified);
			const session =
				activeSessions.find((candidate) => candidate.id === storedSessionId) ?? activeSessions[0];
			if (!session) throw new Error('Stress seed requires an active desk');

			const existingCanvas = canvases.find(
				(canvas) => canvas.sessionId === session.id && canvas.folder === ''
			);
			const canvasId = existingCanvas?.id ?? 'stress-root-canvas';
			const now = Date.now();
			localStorage.setItem('mash.activeSessionId', session.id);
			const writeTransaction = database.transaction(
				['sessions', 'notes', 'canvases', 'canvasItems', 'canvasElements'],
				'readwrite'
			);
			writeTransaction.objectStore('sessions').put({
				...session,
				modified: now,
				lastMeaningfulActivityAt: now,
				...(session.mode === 'scratch' ? { expiresAt: now + 30 * 24 * 60 * 60 * 1_000 } : {})
			});
			const notes = writeTransaction.objectStore('notes');
			const canvasItems = writeTransaction.objectStore('canvasItems');
			const canvasElements = writeTransaction.objectStore('canvasElements');
			if (!existingCanvas) {
				writeTransaction.objectStore('canvases').put({
					id: canvasId,
					folder: '',
					title: 'Stress desk',
					created: now,
					modified: now,
					sessionId: session.id
				});
			}

			for (let index = 0; index < noteCount; index += 1) {
				const id = `stress-note-${index}`;
				const rareNeedle = index === noteCount - 1 ? ` ${searchNeedle}` : '';
				const longTail = 'rough fragment, TODO, [[Loose idea]], café, 東京, 🚧\n'.repeat(
					index % 25 === 0 ? 420 : 18 + (index % 8)
				);
				notes.put({
					id,
					title: `Messy note ${String(index).padStart(4, '0')}${rareNeedle}`,
					body: `# Working note ${index}\n\n- [ ] follow up\n- owner: maybe\n\n${longTail}`,
					folder: `projects/batch-${index % 32}`,
					tags: [`topic-${index % 64}`, `state-${index % 7}`, index % 9 === 0 ? 'shared' : 'loose'],
					links: index > 0 ? [`stress-note-${index - 1}`] : [],
					created: now - index * 1_000,
					modified: now - index,
					pinned: index % 19 === 0 ? 1 : 0,
					sessionId: session.id,
					scope: 'session'
				});

				if (index < canvasCardCount) {
					canvasItems.put({
						id: `stress-item-${index}`,
						canvasId,
						noteId: id,
						x: (index % 20) * 260,
						y: Math.floor(index / 20) * 160,
						w: 220,
						h: 120,
						...(index % 6 === 0 ? { color: 'amber' } : {}),
						...(index % 11 === 0 ? { color: 'blue' } : {})
					});
				}
			}

			const colors = ['green', 'amber', 'blue', 'rose', 'violet', 'slate'] as const;
			for (let index = 0; index < canvasElementCount; index += 1) {
				const from = index % canvasCardCount;
				let to = (index * 7 + 13) % canvasCardCount;
				if (to === from) to = (to + 1) % canvasCardCount;
				canvasElements.put({
					id: `stress-arrow-${index}`,
					canvasId,
					version: 1,
					kind: 'arrow',
					start: { type: 'item', itemId: `stress-item-${from}`, anchor: 'auto' },
					end: { type: 'item', itemId: `stress-item-${to}`, anchor: 'auto' },
					...(index % 9 === 0 ? { label: `relationship ${index}` } : {}),
					color: colors[index % colors.length],
					stroke: index % 4 === 0 ? 'dashed' : 'solid',
					zIndex: index,
					created: now - index,
					modified: now - index
				});
			}

			await transactionDone(writeTransaction);
			database.close();
		},
		{
			noteCount: NOTE_COUNT,
			canvasCardCount: CANVAS_CARD_COUNT,
			canvasElementCount: CANVAS_ELEMENT_COUNT,
			searchNeedle: SEARCH_NEEDLE
		}
	);
}

test('keeps a messy 5,000-note workspace usable', async ({ page }, testInfo) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);
	await seedMessyWorkspace(page);

	const runtimeErrors: string[] = [];
	page.on('pageerror', (error) => runtimeErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') runtimeErrors.push(message.text());
	});

	const startupStartedAt = Date.now();
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Open desks' })).toContainText(
		`${CANVAS_CARD_COUNT} on canvas`,
		{ timeout: 15_000 }
	);
	const startupMs = Date.now() - startupStartedAt;
	const mountedCanvasCards = await page.locator('[data-canvas-card]').count();
	expect(mountedCanvasCards).toBeGreaterThan(0);
	expect(mountedCanvasCards).toBeLessThan(60);
	await expect(page.locator('g[data-canvas-element]')).toHaveCount(CANVAS_ELEMENT_COUNT, {
		timeout: 10_000
	});
	const mountedCanvasElements = await page.locator('g[data-canvas-element]').count();

	const search = page.getByPlaceholder('Search notes to grab…');
	const searchStartedAt = Date.now();
	await search.fill(SEARCH_NEEDLE);
	const searchResults = page.getByRole('listbox', { name: 'Search results' });
	await expect(searchResults.getByText(`Messy note 4999 ${SEARCH_NEEDLE}`)).toBeVisible({
		timeout: 3_000
	});
	const searchMs = Date.now() - searchStartedAt;
	await search.press('Escape');

	const navigationChurnMs = await page.evaluate(async () => {
		const dock = document.querySelector('nav[aria-label="Mash dock"]');
		const labels = ['Folders', 'Tags', 'Linked', 'Desk'];
		const startedAt = performance.now();
		for (let index = 0; index < 32; index += 1) {
			const label = labels[index % labels.length];
			const button = dock?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
			if (!button) throw new Error(`Missing dock button: ${label}`);
			button.click();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		return performance.now() - startedAt;
	});
	await expect(
		page.getByRole('navigation', { name: 'Mash dock' }).locator('button[aria-pressed="true"]')
	).toHaveCount(1);

	await search.fill(SEARCH_NEEDLE);
	await expect(searchResults.getByText(`Messy note 4999 ${SEARCH_NEEDLE}`)).toBeVisible();
	await search.press('Enter');
	const stressCard = page.locator('[data-canvas-card][data-note-id="stress-note-4999"]');
	await expect(stressCard).toBeVisible({ timeout: 5_000 });
	const editorPane = page
		.getByRole('region', { name: 'Note editor stage' })
		.getByRole('region', { name: `Messy note 4999 ${SEARCH_NEEDLE}` });
	await expect(editorPane).toBeVisible({ timeout: 5_000 });
	const body = editorPane.getByRole('textbox', {
		name: 'Write here… Use [[Note title]] for links.'
	});
	const revisedBody = `Last-minute rewrite ${SEARCH_NEEDLE}\n${'revised fragment '.repeat(12_000)}`;
	await body.fill(revisedBody);
	await body.blur();
	await page.waitForTimeout(800);
	const persistedLength = await page.evaluate(async (noteId) => {
		const request = indexedDB.open('mashdb-notes-v1');
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const transaction = database.transaction('notes', 'readonly');
		const getRequest = transaction.objectStore('notes').get(noteId);
		const note = await new Promise<{ body: string }>((resolve, reject) => {
			getRequest.onsuccess = () => resolve(getRequest.result);
			getRequest.onerror = () => reject(getRequest.error);
		});
		database.close();
		return note.body.length;
	}, 'stress-note-4999');
	expect(persistedLength).toBe(revisedBody.length);

	const metrics = {
		startupMs,
		searchMs,
		navigationChurnMs,
		mountedCanvasCards,
		mountedCanvasElements,
		persistedLength
	};
	console.log(`[stress] ${JSON.stringify(metrics)}`);
	await testInfo.attach('messy-workload-metrics.json', {
		body: JSON.stringify(metrics, null, 2),
		contentType: 'application/json'
	});

	expect(startupMs).toBeLessThan(15_000);
	expect(searchMs).toBeLessThan(3_000);
	expect(navigationChurnMs).toBeLessThan(5_000);
	expect(runtimeErrors).toEqual([]);
});

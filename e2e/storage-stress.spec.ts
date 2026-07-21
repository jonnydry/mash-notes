import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { wipeIndexedDb } from './helpers';

const NOTE_COUNT = 300;
const BLOB_COUNT = 16;
const BLOB_BYTES = 512 * 1024;
const CANVAS_CARD_COUNT = 64;
const TARGET_NOTE_ID = 'storage-note-0299';
const TARGET_TITLE = 'Storage text 0299 quota-canary';
const ORIGINAL_MARKER = 'ORIGINAL_PERSISTED_MARKER';
const FAILED_EDIT_MARKER = 'UNSAVED_QUOTA_RECOVERY_MARKER';

/** Minimal valid PNG. Padding after IEND keeps it decodable while applying storage pressure. */
const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seedStorageHeavyWorkspace(page: Page) {
	await page.goto('/robots.txt');
	await page.evaluate(
		async ({ noteCount, blobCount, blobBytes, canvasCardCount, pngBase64 }) => {
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
			type SeedCanvas = {
				id: string;
				folder: string;
				title: string;
				created: number;
				modified: number;
				sessionId?: string;
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
			)) as SeedCanvas[];
			await transactionDone(readTransaction);

			const storedSessionId = localStorage.getItem('mash.activeSessionId');
			const activeSessions = sessions
				.filter((candidate) => candidate.status === 'active')
				.sort((a, b) => b.modified - a.modified);
			const session =
				activeSessions.find((candidate) => candidate.id === storedSessionId) ?? activeSessions[0];
			if (!session) throw new Error('Storage stress seed requires an active desk');

			const existingCanvas = canvases.find(
				(canvas) => canvas.sessionId === session.id && canvas.folder === ''
			);
			const canvasId = existingCanvas?.id ?? 'storage-stress-root-canvas';
			const now = Date.now();
			localStorage.setItem('mash.activeSessionId', session.id);
			const writeTransaction = database.transaction(
				['sessions', 'notes', 'canvases', 'canvasItems', 'noteBlobs'],
				'readwrite'
			);
			writeTransaction.objectStore('sessions').put({
				...session,
				modified: now,
				lastMeaningfulActivityAt: now,
				...(session.mode === 'scratch' ? { expiresAt: now + 30 * 24 * 60 * 60 * 1_000 } : {})
			});
			writeTransaction.objectStore('canvases').put({
				...(existingCanvas ?? {
					id: canvasId,
					folder: '',
					title: 'Storage stress desk',
					created: now,
					sessionId: session.id
				}),
				modified: now
			});

			const notes = writeTransaction.objectStore('notes');
			const canvasItems = writeTransaction.objectStore('canvasItems');
			const noteBlobs = writeTransaction.objectStore('noteBlobs');
			const pngBinary = atob(pngBase64);
			const pngBytes = new Uint8Array(pngBinary.length);
			for (let index = 0; index < pngBinary.length; index += 1) {
				pngBytes[index] = pngBinary.charCodeAt(index);
			}

			for (let index = 0; index < blobCount; index += 1) {
				const blobId = `storage-blob-${String(index).padStart(4, '0')}`;
				const bytes = new Uint8Array(blobBytes);
				bytes.set(pngBytes);
				for (let offset = pngBytes.length; offset < bytes.length; offset += 1) {
					bytes[offset] = (offset * 17 + index * 31) & 0xff;
				}
				noteBlobs.put({
					id: blobId,
					mime: 'image/png',
					bytes: bytes.buffer,
					width: 1,
					height: 1,
					created: now - index
				});
			}

			const textTail =
				'rough capture, duplicate thought, TODO owner?, café, 東京, [[Loose link]]\n'.repeat(150);
			for (let index = 0; index < noteCount; index += 1) {
				const id = `storage-note-${String(index).padStart(4, '0')}`;
				const isImage = index < blobCount;
				const isTarget = index === noteCount - 1;
				const title = isImage
					? `Storage image ${String(index).padStart(4, '0')}`
					: isTarget
						? 'Storage text 0299 quota-canary'
						: `Storage text ${String(index).padStart(4, '0')}`;
				const body = isImage
					? `![Storage image ${index}](mash-blob:storage-blob-${String(index).padStart(4, '0')})`
					: `# Storage note ${index}\n\n${isTarget ? 'ORIGINAL_PERSISTED_MARKER\n\n' : ''}${textTail}`;
				notes.put({
					id,
					title,
					body,
					folder: `storage/batch-${index % 12}`,
					tags: ['storage-stress', `batch-${index % 12}`, isImage ? 'visual' : 'text'],
					links: [],
					created: now - index * 1_000,
					modified: now - index,
					pinned: index % 41 === 0 ? 1 : 0,
					sessionId: session.id,
					scope: 'session'
				});

				if (index < canvasCardCount) {
					canvasItems.put({
						id: `storage-item-${String(index).padStart(4, '0')}`,
						canvasId,
						noteId: id,
						x: (index % 8) * 260,
						y: Math.floor(index / 8) * 160,
						w: 220,
						h: 120
					});
				}
			}

			await transactionDone(writeTransaction);
			database.close();
		},
		{
			noteCount: NOTE_COUNT,
			blobCount: BLOB_COUNT,
			blobBytes: BLOB_BYTES,
			canvasCardCount: CANVAS_CARD_COUNT,
			pngBase64: PNG_BASE64
		}
	);
}

async function readStressRows(page: Page) {
	return page.evaluate(async () => {
		const requestResult = <T>(request: IDBRequest<T>) =>
			new Promise<T>((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		const database = await requestResult(indexedDB.open('mashdb-notes-v1'));
		const transaction = database.transaction(['notes', 'canvasItems', 'noteBlobs'], 'readonly');
		const [notes, canvasItems, blobs] = await Promise.all([
			requestResult(transaction.objectStore('notes').getAll()) as Promise<
				Array<{ id: string; body: string }>
			>,
			requestResult(transaction.objectStore('canvasItems').getAll()) as Promise<
				Array<{ id: string }>
			>,
			requestResult(transaction.objectStore('noteBlobs').getAll()) as Promise<
				Array<{ id: string; bytes: ArrayBuffer }>
			>
		]);
		database.close();
		return {
			noteCount: notes.filter((note) => note.id.startsWith('storage-note-')).length,
			canvasItemCount: canvasItems.filter((item) => item.id.startsWith('storage-item-')).length,
			blobCount: blobs.filter((blob) => blob.id.startsWith('storage-blob-')).length,
			blobBytes: blobs
				.filter((blob) => blob.id.startsWith('storage-blob-'))
				.reduce((total, blob) => total + blob.bytes.byteLength, 0),
			targetBody: notes.find((note) => note.id === 'storage-note-0299')?.body ?? ''
		};
	});
}

test('backs up, restores, and recovers a storage-heavy workspace', async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	await wipeIndexedDb(page);
	await seedStorageHeavyWorkspace(page);

	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));

	const reloadStartedAt = Date.now();
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Open desks' })).toContainText(
		`${CANVAS_CARD_COUNT} on canvas`,
		{ timeout: 20_000 }
	);
	const reloadMs = Date.now() - reloadStartedAt;

	const beforeBackup = await readStressRows(page);
	expect(beforeBackup).toMatchObject({
		noteCount: NOTE_COUNT,
		canvasItemCount: CANVAS_CARD_COUNT,
		blobCount: BLOB_COUNT,
		blobBytes: BLOB_COUNT * BLOB_BYTES
	});
	expect(beforeBackup.targetBody).toContain(ORIGINAL_MARKER);

	await page.getByRole('button', { name: 'Settings' }).click();
	const backupStartedAt = Date.now();
	const backupDownloadPromise = page.waitForEvent('download');
	await page.getByTestId('backup-workspace').click();
	const backupDownload = await backupDownloadPromise;
	await expect(page.getByTestId('action-status')).toContainText('Workspace backup created', {
		timeout: 30_000
	});
	const backupMs = Date.now() - backupStartedAt;
	const backupPath = await backupDownload.path();
	expect(backupPath).toBeTruthy();
	if (!backupPath) throw new Error('Storage stress backup did not produce a local file');

	const backupRaw = await readFile(backupPath, 'utf8');
	const backupBytes = Buffer.byteLength(backupRaw);
	const backup = JSON.parse(backupRaw) as {
		notes: Array<{ id: string }>;
		canvasItems: Array<{ id: string }>;
		blobs: Array<{ id: string; dataBase64: string }>;
		integrity: { algorithm: string; digest: string };
	};
	expect(backupBytes).toBeGreaterThan(10 * 1024 * 1024);
	expect(backupBytes).toBeLessThan(50_000_000);
	expect(backup.notes.filter((note) => note.id.startsWith('storage-note-'))).toHaveLength(
		NOTE_COUNT
	);
	expect(backup.canvasItems.filter((item) => item.id.startsWith('storage-item-'))).toHaveLength(
		CANVAS_CARD_COUNT
	);
	expect(backup.blobs.filter((blob) => blob.id.startsWith('storage-blob-'))).toHaveLength(
		BLOB_COUNT
	);
	expect(backup.integrity).toEqual({
		algorithm: 'SHA-256',
		digest: expect.stringMatching(/^[a-f0-9]{64}$/)
	});

	await wipeIndexedDb(page);
	const restoreStartedAt = Date.now();
	await page.getByTestId('workspace-restore-input').setInputFiles(backupPath);
	const restoreDialog = page.getByTestId('workspace-restore-dialog');
	await expect(restoreDialog).toBeVisible({ timeout: 30_000 });
	await restoreDialog.getByRole('button', { name: 'Restore backup' }).click();
	await expect(page.getByTestId('action-status')).toContainText('Restored workspace', {
		timeout: 45_000
	});
	const restoreMs = Date.now() - restoreStartedAt;

	await expect(page.getByRole('button', { name: 'Open desks' })).toContainText(
		`${CANVAS_CARD_COUNT} on canvas`,
		{ timeout: 20_000 }
	);
	const afterRestore = await readStressRows(page);
	expect(afterRestore).toEqual(beforeBackup);

	const search = page.getByPlaceholder('Search notes to grab…');
	await search.fill('quota-canary');
	const searchResults = page.getByRole('listbox', { name: 'Search results' });
	await expect(searchResults.getByText(TARGET_TITLE)).toBeVisible({ timeout: 5_000 });
	await search.press('Enter');
	const targetCard = page
		.getByRole('group', { name: TARGET_TITLE, exact: true })
		.and(page.locator('[data-canvas-card][data-expanded="true"]'));
	await expect(targetCard).toBeVisible({ timeout: 5_000 });
	await targetCard.getByRole('button', { name: 'Open large editor' }).click();
	const editorPane = page
		.getByRole('region', { name: 'Note editor stage' })
		.getByRole('region', { name: TARGET_TITLE });
	await expect(editorPane).toBeVisible({ timeout: 5_000 });
	const body = editorPane.getByRole('textbox', {
		name: 'Write here… Use [[Note title]] for links.'
	});

	await page.evaluate(() => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function quotaPut(value: unknown, key?: IDBValidKey) {
			if (this.name === 'notes') {
				throw new DOMException('Storage stress quota reached', 'QuotaExceededError');
			}
			return Reflect.apply(originalPut, this, key === undefined ? [value] : [value, key]);
		};
	});

	const failedBody = `${FAILED_EDIT_MARKER}\n${'last-minute recovery text '.repeat(12_000)}`;
	await body.fill(failedBody);
	await body.blur();
	const writeAlert = page.getByRole('alert').filter({
		hasText: 'Changes are still open in memory, but this browser could not save them locally.'
	});
	await expect(writeAlert).toBeVisible({ timeout: 10_000 });

	const emergencyDownloadPromise = page.waitForEvent('download');
	await writeAlert.getByRole('button', { name: 'Emergency export' }).click();
	const emergencyDownload = await emergencyDownloadPromise;
	const emergencyPath = await emergencyDownload.path();
	expect(emergencyPath).toBeTruthy();
	if (!emergencyPath) throw new Error('Emergency export did not produce a local file');
	const emergencyNotes = JSON.parse(await readFile(emergencyPath, 'utf8')) as Array<{
		id: string;
		body: string;
	}>;
	expect(emergencyNotes.find((note) => note.id === TARGET_NOTE_ID)?.body).toContain(
		FAILED_EDIT_MARKER
	);

	const afterFailedWrite = await readStressRows(page);
	expect(afterFailedWrite.targetBody).toContain(ORIGINAL_MARKER);
	expect(afterFailedWrite.targetBody).not.toContain(FAILED_EDIT_MARKER);

	await page.reload();
	await expect(page.getByRole('button', { name: 'Open desks' })).toContainText(
		`${CANVAS_CARD_COUNT + 1} on canvas`,
		{ timeout: 20_000 }
	);
	const afterRecoveryReload = await readStressRows(page);
	expect(afterRecoveryReload.targetBody).toBe(afterFailedWrite.targetBody);
	expect(pageErrors).toEqual([]);

	const metrics = {
		reloadMs,
		backupMs,
		restoreMs,
		backupBytes,
		noteCount: afterRestore.noteCount,
		blobCount: afterRestore.blobCount,
		blobBytes: afterRestore.blobBytes,
		canvasItemCount: afterRestore.canvasItemCount,
		emergencyExportRecoveredBytes: failedBody.length
	};
	console.log(`[storage-stress] ${JSON.stringify(metrics)}`);
	await testInfo.attach('storage-stress-metrics.json', {
		body: JSON.stringify(metrics, null, 2),
		contentType: 'application/json'
	});

	expect(reloadMs).toBeLessThan(20_000);
	expect(backupMs).toBeLessThan(30_000);
	expect(restoreMs).toBeLessThan(45_000);
});

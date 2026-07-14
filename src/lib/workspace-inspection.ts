/**
 * Lightweight workspace health inspection for the startup path.
 *
 * Full workspace backup code also owns merge, validation, and blob encoding.
 * Keeping this probe separate avoids loading that machinery just to decide
 * whether the user should see a backup reminder.
 */
import { db } from './db';
import { extractBlobIdsFromNotes, getNoteBlobsByIds } from './note-blobs';

function timestamp(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function inspectWorkspaceChangedAt(): Promise<{
	changedAt: number;
	hasContent: boolean;
}> {
	const [
		latestSessionModified,
		latestSessionActivity,
		latestNoteModified,
		latestNoteDeletion,
		latestCanvasModified,
		latestOperationCreated,
		latestOperationReverted,
		sessionCount,
		activeNotes
	] = await Promise.all([
		db.sessions.orderBy('modified').last(),
		db.sessions.orderBy('lastMeaningfulActivityAt').last(),
		db.notes.orderBy('modified').last(),
		db.notes.orderBy('deletedAt').last(),
		db.canvases.orderBy('modified').last(),
		db.operations.orderBy('created').last(),
		db.operations.orderBy('revertedAt').last(),
		db.sessions.count(),
		db.notes.filter((note) => note.deletedAt == null).toArray()
	]);
	const referencedBlobs = await getNoteBlobsByIds(extractBlobIdsFromNotes(activeNotes));

	return {
		changedAt: Math.max(
			0,
			timestamp(latestSessionModified?.modified),
			timestamp(latestSessionActivity?.lastMeaningfulActivityAt),
			timestamp(latestNoteModified?.modified),
			timestamp(latestNoteDeletion?.deletedAt),
			timestamp(latestCanvasModified?.modified),
			timestamp(latestOperationCreated?.created),
			timestamp(latestOperationReverted?.revertedAt),
			...referencedBlobs.map((blob) => timestamp(blob.created))
		),
		hasContent: activeNotes.some((note) => note.system !== 'mash-team-welcome') || sessionCount > 1
	};
}

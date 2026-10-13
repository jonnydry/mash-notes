/**
 * First-load delete-marker writes. Recording stays in the shell so a card,
 * link, or arrow removed before any bundle import is still in the next export.
 */
import { canvasElementItemIds } from './canvas-elements';
import { db } from './db';
import {
	canvasElementDeletionKey,
	deletionExpired,
	deskDeletionId,
	type DeskDeletionMarker
} from './desk-deletions';
import type { CanvasEdge, CanvasElement } from './types';

export async function rememberDeskDeletion(marker: DeskDeletionMarker): Promise<void> {
	if (deletionExpired(marker.deletedAt)) return;
	const id = deskDeletionId(marker);
	if (!id) return;
	const existing = await db.deskDeletions.get(id);
	if (existing && existing.deletedAt >= marker.deletedAt) return;
	await db.deskDeletions.put({ ...marker, id });
}

async function noteIdsForItems(itemIds: string[]): Promise<Map<string, string>> {
	const unique = [...new Set(itemIds)];
	const items = unique.length > 0 ? await db.canvasItems.bulkGet(unique) : [];
	const notes = new Map<string, string>();
	for (const item of items) {
		if (item) notes.set(item.id, item.noteId);
	}
	return notes;
}

export async function rememberItem(
	canvasId: string,
	noteId: string,
	deletedAt = Date.now()
): Promise<void> {
	await rememberDeskDeletion({ kind: 'item', canvasId, noteId, deletedAt });
}

/** Edit time strictly after a deletion, even when undo lands in the same millisecond. */
export function restoredEditTime(deletedAt: number, now = Date.now()): number {
	return Math.max(now, deletedAt + 1);
}

async function forgetStored(
	marker: Pick<
		DeskDeletionMarker,
		'kind' | 'canvasId' | 'noteId' | 'fromNoteId' | 'toNoteId' | 'elementKey'
	>
): Promise<number | null> {
	const id = deskDeletionId(marker);
	if (!id) return null;
	const existing = await db.deskDeletions.get(id);
	if (!existing) return null;
	await db.deskDeletions.delete(id);
	return existing.deletedAt;
}

export async function forgetItem(canvasId: string, noteId: string): Promise<number | null> {
	return forgetStored({ kind: 'item', canvasId, noteId });
}

export async function forgetEdgeDeletion(edge: CanvasEdge): Promise<number | null> {
	const notes = await noteIdsForItems([edge.fromItemId, edge.toItemId]);
	const fromNoteId = notes.get(edge.fromItemId);
	const toNoteId = notes.get(edge.toItemId);
	if (!fromNoteId || !toNoteId) return null;
	return forgetStored({ kind: 'edge', canvasId: edge.canvasId, fromNoteId, toNoteId });
}

export async function forgetElementDeletion(element: CanvasElement): Promise<number | null> {
	const notes = await noteIdsForItems(canvasElementItemIds(element));
	const elementKey = canvasElementDeletionKey(element, notes);
	if (!elementKey) return null;
	return forgetStored({ kind: 'element', canvasId: element.canvasId, elementKey });
}

export async function rememberEdgeDeletion(
	edge: CanvasEdge,
	deletedAt = Date.now()
): Promise<void> {
	const notes = await noteIdsForItems([edge.fromItemId, edge.toItemId]);
	const fromNoteId = notes.get(edge.fromItemId);
	const toNoteId = notes.get(edge.toItemId);
	if (!fromNoteId || !toNoteId) return;
	await rememberDeskDeletion({
		kind: 'edge',
		canvasId: edge.canvasId,
		fromNoteId,
		toNoteId,
		deletedAt
	});
}

export async function rememberElementDeletion(
	element: CanvasElement,
	deletedAt = Date.now()
): Promise<void> {
	const notes = await noteIdsForItems(canvasElementItemIds(element));
	const elementKey = canvasElementDeletionKey(element, notes);
	if (!elementKey) return;
	await rememberDeskDeletion({
		kind: 'element',
		canvasId: element.canvasId,
		elementKey,
		deletedAt
	});
}

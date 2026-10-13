import type { CanvasArrowEndpoint, CanvasElement } from './types';

/** Keep canvas delete markers for the same window as note tombstones. */
export const DESK_DELETION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type DeskDeletionKind = 'item' | 'edge' | 'element';

/** A card, link, or arrow removed on a desk. Identity survives item-id remap. */
export type DeskDeletionMarker = {
	kind: DeskDeletionKind;
	canvasId: string;
	deletedAt: number;
	noteId?: string;
	fromNoteId?: string;
	toNoteId?: string;
	elementKey?: string;
};

export type StoredDeskDeletion = DeskDeletionMarker & { id: string };

export function deletionExpired(deletedAt: number, now = Date.now()): boolean {
	return deletedAt < now - DESK_DELETION_RETENTION_MS;
}

/**
 * Arrow identity after canvas item ids have been remapped.
 * Point ends keep their coordinates. Card ends use the note id and anchor.
 */
export function canvasElementDeletionKey(
	element: Pick<CanvasElement, 'kind' | 'start' | 'end' | 'label' | 'color' | 'stroke'>,
	noteIdByItemId: ReadonlyMap<string, string>
): string | null {
	const endpoint = (end: CanvasArrowEndpoint): string | null => {
		if (end.type === 'point') return `point:${end.x}:${end.y}`;
		const noteId = noteIdByItemId.get(end.itemId);
		if (!noteId) return null;
		return `item:${noteId}:${end.anchor}`;
	};
	const start = endpoint(element.start);
	const end = endpoint(element.end);
	if (!start || !end) return null;
	return JSON.stringify({
		kind: element.kind,
		start,
		end,
		label: element.label ?? '',
		color: element.color ?? '',
		stroke: element.stroke ?? 'solid'
	});
}

export function deskDeletionId(
	marker: Pick<
		DeskDeletionMarker,
		'kind' | 'canvasId' | 'noteId' | 'fromNoteId' | 'toNoteId' | 'elementKey'
	>
): string | null {
	if (marker.kind === 'item') {
		if (!marker.noteId) return null;
		return `item\u0000${marker.canvasId}\u0000${marker.noteId}`;
	}
	if (marker.kind === 'edge') {
		if (!marker.fromNoteId || !marker.toNoteId || marker.fromNoteId === marker.toNoteId)
			return null;
		return `edge\u0000${marker.canvasId}\u0000${marker.fromNoteId}\u0000${marker.toNoteId}`;
	}
	if (!marker.elementKey) return null;
	return `element\u0000${marker.canvasId}\u0000${marker.elementKey}`;
}

/** A placement edit after this time brings a deleted card, link, or arrow back. */
export function editBeatsDeletion(editedAt: number, deletedAt: number): boolean {
	return editedAt > deletedAt;
}

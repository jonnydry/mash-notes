/**
 * File-based sync transport on top of LWW merge.
 * Desk bundle v6 adds canvas appearance and cosmetic elements to notes, layout,
 * tombstones, provenance, and visual assets. Versions 1 through 5 still import.
 */
import type {
	Canvas,
	CanvasArrowAnchor,
	CanvasBowl,
	CanvasEdge,
	CanvasElement,
	CanvasItem,
	Note,
	NoteBlob,
	NoteBlobMime,
	Operation
} from './types';
import { mergeNotesLww, hasConflicts, type MergeResult, type SyncConflict } from './sync-model';
import { SYNC_BUNDLE_MAX_CHARS } from './sync-limits';
import { normalizeImportedNote } from './import-notes';
import { db, getSyncTombstoneNotes, newId } from './db';
import { exportAllDismissed, importDismissedMap, type DismissedByCanvas } from './canvas-dismiss';
import {
	bytesToDataUrl,
	dataUrlToBytes,
	extractBlobIdsFromNotes,
	getNoteBlobsByIds,
	normalizeBlobMime
} from './note-blobs';
import {
	CANVAS_ARROW_ANCHORS,
	canvasElementBindsItem,
	cloneCanvasElement,
	isCanvasColor,
	remapCanvasElement
} from './canvas-elements';

export const SYNC_BUNDLE_VERSION = 6 as const;
export const SYNC_BUNDLE_VERSION_V5 = 5 as const;
export const SYNC_BUNDLE_VERSION_V4 = 4 as const;
export const SYNC_BUNDLE_VERSION_V3 = 3 as const;
export const SYNC_BUNDLE_VERSION_V2 = 2 as const;
export const SYNC_BUNDLE_VERSION_V1 = 1 as const;
export { SYNC_BUNDLE_MAX_CHARS } from './sync-limits';

const MAX_ID_CHARS = 128;
const MAX_DISMISSED_PER_CANVAS = 5000;
const MAX_OPERATION_NOTE_IDS = 1000;
const MAX_OPERATION_PAYLOAD_CHARS = 100_000;
const MAX_SYNC_BLOB_BASE64_CHARS = 5_600_000;
const MAX_SYNC_BLOBS_BASE64_CHARS = 6_500_000;
const MAX_CANVAS_COORDINATE = 1_000_000;
const MAX_CANVAS_ITEM_EDGE = 5000;
const MAX_CANVAS_ELEMENTS = 50_000;
const MAX_CANVAS_ELEMENT_LABEL_CHARS = 200;

/** Keep soft-delete tombstones in sync exports for this long. */
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type SyncTombstone = {
	id: string;
	deletedAt: number;
};

export type DeskSnapshot = {
	canvases: Canvas[];
	items: CanvasItem[];
	/** Directed flow edges between canvas items (optional on older bundles). */
	edges?: CanvasEdge[];
	/** Cosmetic canvas marks. Introduced in v6; absent on older bundles. */
	elements?: CanvasElement[];
	/** canvasId → dismissed note ids */
	dismissed: DismissedByCanvas;
};

/** Transport-only image payload (v5). Rehydrated into noteBlobs on import. */
export type SyncBlob = {
	id: string;
	mime: NoteBlobMime;
	width: number;
	height: number;
	dataBase64: string;
};

export type SyncBundle = {
	version:
		| typeof SYNC_BUNDLE_VERSION
		| typeof SYNC_BUNDLE_VERSION_V5
		| typeof SYNC_BUNDLE_VERSION_V4
		| typeof SYNC_BUNDLE_VERSION_V3
		| typeof SYNC_BUNDLE_VERSION_V2
		| typeof SYNC_BUNDLE_VERSION_V1;
	exportedAt: number;
	notes: Note[];
	desk?: DeskSnapshot;
	tombstones?: SyncTombstone[];
	/** Durable provenance receipts. Introduced in v4. */
	operations?: Operation[];
	/** Out-of-line note images. Introduced in v5. */
	blobs?: SyncBlob[];
};

export type DeskApplySummary = {
	canvasesUpserted: number;
	itemsUpserted: number;
	itemsSkipped: number;
	edgesUpserted: number;
	edgesSkipped: number;
	elementsUpserted: number;
	elementsSkipped: number;
};

export type SyncMergeSummary = {
	added: number;
	updated: number;
	unchanged: number;
	removed: number;
	results: MergeResult[];
	conflicts: SyncConflict[];
	desk?: DeskApplySummary;
	operationsUpserted?: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function boundedId(value: unknown): string {
	return asString(value).trim().slice(0, MAX_ID_CHARS);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, asNumber(value, fallback)));
}

function normalizeCanvas(raw: unknown, index: number): Canvas | string {
	if (!isRecord(raw)) return `Canvas ${index + 1} is not an object`;
	const id = boundedId(raw.id);
	if (!id) return `Canvas ${index + 1} missing id`;
	const now = Date.now();
	const canvas: Canvas = {
		id,
		folder: asString(raw.folder).slice(0, 200),
		title: asString(raw.title, 'Desk').slice(0, 200) || 'Desk',
		created: asNumber(raw.created, now),
		modified: asNumber(raw.modified, now)
	};
	if (Array.isArray(raw.bowls)) {
		if (raw.bowls.length > 100) return `Canvas ${index + 1} has too many bowls`;
		const bowls: CanvasBowl[] = [];
		for (const candidate of raw.bowls) {
			if (!isRecord(candidate) || !Array.isArray(candidate.itemIds)) continue;
			const bowlId = boundedId(candidate.id);
			const itemIds = candidate.itemIds
				.filter((id): id is string => typeof id === 'string')
				.map((id) => id.slice(0, MAX_ID_CHARS));
			if (!bowlId || itemIds.length < 2 || itemIds.length > 500) continue;
			bowls.push({
				id: bowlId,
				name: asString(candidate.name, 'New bowl').trim().slice(0, 80) || 'New bowl',
				itemIds: [...new Set(itemIds)],
				created: asNumber(candidate.created, now),
				modified: asNumber(candidate.modified, now)
			});
		}
		if (bowls.length > 0) canvas.bowls = bowls;
	}
	return canvas;
}

function normalizeCanvasItem(raw: unknown, index: number): CanvasItem | string {
	if (!isRecord(raw)) return `Canvas item ${index + 1} is not an object`;
	const id = boundedId(raw.id) || newId();
	const canvasId = boundedId(raw.canvasId);
	const noteId = boundedId(raw.noteId);
	if (!canvasId || !noteId) return `Canvas item ${index + 1} missing canvasId/noteId`;
	const item: CanvasItem = {
		id,
		canvasId,
		noteId,
		x: clampNumber(raw.x, 40, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE),
		y: clampNumber(raw.y, 40, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE)
	};
	if (typeof raw.w === 'number' && Number.isFinite(raw.w)) {
		item.w = clampNumber(raw.w, 220, 1, MAX_CANVAS_ITEM_EDGE);
	}
	if (typeof raw.h === 'number' && Number.isFinite(raw.h)) {
		item.h = clampNumber(raw.h, 160, 1, MAX_CANVAS_ITEM_EDGE);
	}
	if (isCanvasColor(raw.color)) item.color = raw.color;
	return item;
}

function normalizeCanvasElementEndpoint(
	raw: unknown,
	elementIndex: number,
	name: 'start' | 'end'
): CanvasElement['start'] | string {
	if (!isRecord(raw)) return `Canvas element ${elementIndex + 1} has an invalid ${name}`;
	if (raw.type === 'point') {
		return {
			type: 'point',
			x: clampNumber(raw.x, 0, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE),
			y: clampNumber(raw.y, 0, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE)
		};
	}
	if (raw.type === 'item') {
		const itemId = boundedId(raw.itemId);
		if (!itemId) return `Canvas element ${elementIndex + 1} has a missing ${name} item`;
		const anchor =
			typeof raw.anchor === 'string' &&
			(CANVAS_ARROW_ANCHORS as readonly string[]).includes(raw.anchor)
				? (raw.anchor as CanvasArrowAnchor)
				: 'auto';
		return { type: 'item', itemId, anchor };
	}
	return `Canvas element ${elementIndex + 1} has an unsupported ${name} binding`;
}

function normalizeCanvasElement(raw: unknown, index: number): CanvasElement | string {
	if (!isRecord(raw)) return `Canvas element ${index + 1} is not an object`;
	if (raw.kind !== 'arrow') return `Canvas element ${index + 1} has an unsupported kind`;
	if (raw.version !== undefined && raw.version !== 1) {
		return `Canvas element ${index + 1} has an unsupported version`;
	}
	const canvasId = boundedId(raw.canvasId);
	if (!canvasId) return `Canvas element ${index + 1} is missing canvasId`;
	const start = normalizeCanvasElementEndpoint(raw.start, index, 'start');
	if (typeof start === 'string') return start;
	const end = normalizeCanvasElementEndpoint(raw.end, index, 'end');
	if (typeof end === 'string') return end;
	const now = Date.now();
	const element: CanvasElement = {
		id: boundedId(raw.id) || newId(),
		canvasId,
		version: 1,
		kind: 'arrow',
		start,
		end,
		zIndex: Math.trunc(clampNumber(raw.zIndex, 0, -MAX_CANVAS_ELEMENTS, MAX_CANVAS_ELEMENTS)),
		created: asNumber(raw.created, now),
		modified: asNumber(raw.modified, now)
	};
	if (typeof raw.label === 'string') {
		const label = raw.label.trim().slice(0, MAX_CANVAS_ELEMENT_LABEL_CHARS);
		if (label) element.label = label;
	}
	if (isCanvasColor(raw.color)) element.color = raw.color;
	if (raw.stroke === 'dashed') element.stroke = 'dashed';
	return element;
}

function normalizeCanvasEdge(raw: unknown, index: number): CanvasEdge | string {
	if (!isRecord(raw)) return `Canvas edge ${index + 1} is not an object`;
	const canvasId = boundedId(raw.canvasId);
	const fromItemId = boundedId(raw.fromItemId);
	const toItemId = boundedId(raw.toItemId);
	if (!canvasId || !fromItemId || !toItemId) {
		return `Canvas edge ${index + 1} missing canvasId/from/to`;
	}
	if (fromItemId === toItemId) return `Canvas edge ${index + 1} is a self-loop`;
	return {
		id: boundedId(raw.id) || newId(),
		canvasId,
		fromItemId,
		toItemId,
		created: asNumber(raw.created, Date.now())
	};
}

function normalizeDismissed(raw: unknown): DismissedByCanvas | string {
	if (!isRecord(raw)) return {};
	const entries = Object.entries(raw);
	if (entries.length > 200) return 'Too many dismissed canvas lists in sync bundle';
	const out: DismissedByCanvas = {};
	for (const [rawCanvasId, ids] of entries) {
		if (!Array.isArray(ids)) continue;
		if (ids.length > MAX_DISMISSED_PER_CANVAS) {
			return `Too many dismissed notes for canvas ${rawCanvasId.slice(0, 40)}`;
		}
		const canvasId = rawCanvasId.trim().slice(0, MAX_ID_CHARS);
		if (!canvasId) continue;
		out[canvasId] = ids
			.filter((id): id is string => typeof id === 'string')
			.map((id) => id.slice(0, MAX_ID_CHARS))
			.filter(Boolean);
	}
	return out;
}

function normalizeDesk(raw: unknown): DeskSnapshot | string {
	if (raw == null) {
		return { canvases: [], items: [], edges: [], dismissed: {} };
	}
	if (!isRecord(raw)) return 'Desk snapshot is not an object';
	const canvasesRaw = Array.isArray(raw.canvases) ? raw.canvases : [];
	const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
	const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
	const elementsRaw = Array.isArray(raw.elements) ? raw.elements : [];
	if (canvasesRaw.length > 200) return 'Too many canvases in sync bundle';
	if (itemsRaw.length > 20_000) return 'Too many canvas items in sync bundle';
	if (edgesRaw.length > 50_000) return 'Too many canvas edges in sync bundle';
	if (elementsRaw.length > MAX_CANVAS_ELEMENTS) return 'Too many canvas elements in sync bundle';

	const canvases: Canvas[] = [];
	const canvasIds = new Set<string>();
	const canvasFolders = new Set<string>();
	for (let i = 0; i < canvasesRaw.length; i++) {
		const c = normalizeCanvas(canvasesRaw[i], i);
		if (typeof c === 'string') return c;
		if (canvasIds.has(c.id)) return `Duplicate canvas id: ${c.id.slice(0, 40)}`;
		if (canvasFolders.has(c.folder)) return `Duplicate canvas folder: ${c.folder.slice(0, 40)}`;
		canvasIds.add(c.id);
		canvasFolders.add(c.folder);
		canvases.push(c);
	}
	const items: CanvasItem[] = [];
	const itemIds = new Set<string>();
	const placements = new Set<string>();
	for (let i = 0; i < itemsRaw.length; i++) {
		const item = normalizeCanvasItem(itemsRaw[i], i);
		if (typeof item === 'string') return item;
		if (itemIds.has(item.id)) return `Duplicate canvas item id: ${item.id.slice(0, 40)}`;
		const placement = JSON.stringify([item.canvasId, item.noteId]);
		if (placements.has(placement)) return `Duplicate note placement at canvas item ${i + 1}`;
		itemIds.add(item.id);
		placements.add(placement);
		items.push(item);
	}
	const edges: CanvasEdge[] = [];
	const edgeIds = new Set<string>();
	for (let i = 0; i < edgesRaw.length; i++) {
		const edge = normalizeCanvasEdge(edgesRaw[i], i);
		if (typeof edge === 'string') return edge;
		if (edgeIds.has(edge.id)) return `Duplicate canvas edge id: ${edge.id.slice(0, 40)}`;
		edgeIds.add(edge.id);
		edges.push(edge);
	}
	const elements: CanvasElement[] = [];
	const elementIds = new Set<string>();
	const itemCanvas = new Map(items.map((item) => [item.id, item.canvasId]));
	for (let i = 0; i < elementsRaw.length; i++) {
		const element = normalizeCanvasElement(elementsRaw[i], i);
		if (typeof element === 'string') return element;
		if (elementIds.has(element.id)) {
			return `Duplicate canvas element id: ${element.id.slice(0, 40)}`;
		}
		if (!canvasIds.has(element.canvasId)) {
			return `Canvas element ${i + 1} references an unknown canvas`;
		}
		const brokenBinding = [element.start, element.end].some(
			(endpoint) => endpoint.type === 'item' && itemCanvas.get(endpoint.itemId) !== element.canvasId
		);
		if (brokenBinding) return `Canvas element ${i + 1} contains a broken card binding`;
		elementIds.add(element.id);
		elements.push(element);
	}
	const dismissed = normalizeDismissed(raw.dismissed);
	if (typeof dismissed === 'string') return dismissed;
	return {
		canvases,
		items,
		edges,
		elements,
		dismissed
	};
}

/** Load current desk layout from IndexedDB + local dismissals. */
export async function collectDeskSnapshot(sessionId?: string): Promise<DeskSnapshot> {
	const canvases = sessionId
		? await db.canvases.where('sessionId').equals(sessionId).toArray()
		: await db.canvases.toArray();
	const canvasIds = new Set(canvases.map((canvas) => canvas.id));
	const allItems = await db.canvasItems.toArray();
	const items = allItems.filter((item) => canvasIds.has(item.canvasId));
	const allEdges = await db.canvasEdges.toArray();
	const edges = allEdges.filter((edge) => canvasIds.has(edge.canvasId));
	const allElements = await db.canvasElements.toArray();
	const elements = allElements.filter((element) => canvasIds.has(element.canvasId));
	const allDismissed = exportAllDismissed();
	const dismissed = Object.fromEntries(
		Object.entries(allDismissed).filter(([canvasId]) => canvasIds.has(canvasId))
	);
	return {
		canvases: canvases.map((c) => ({
			...c,
			...(c.bowls
				? { bowls: c.bowls.map((bowl) => ({ ...bowl, itemIds: [...bowl.itemIds] })) }
				: {})
		})),
		items: items.map((i) => ({ ...i })),
		edges: edges.map((e) => ({ ...e })),
		elements: elements.map(cloneCanvasElement),
		dismissed
	};
}

export async function buildSyncBundle(notes: Note[], sessionId?: string): Promise<SyncBundle> {
	const desk = await collectDeskSnapshot(sessionId);
	const operationRows = sessionId
		? await db.operations.where('sessionId').equals(sessionId).toArray()
		: await db.operations.toArray();
	const operations = operationRows.map((operation) => ({
		...operation,
		inputNoteIds: [...operation.inputNoteIds],
		outputNoteIds: [...operation.outputNoteIds],
		...(operation.payload ? { payload: { ...operation.payload } } : {})
	}));
	const deleted = await getSyncTombstoneNotes(TOMBSTONE_RETENTION_MS);
	const active = notes
		.filter((n) => n.deletedAt == null)
		.map((n) => {
			const rest = { ...n };
			delete rest.deletedAt;
			return { ...rest };
		});
	const tombstones: SyncTombstone[] = deleted
		.filter(
			(n) =>
				typeof n.deletedAt === 'number' && (!sessionId || !n.sessionId || n.sessionId === sessionId)
		)
		.map((n) => ({ id: n.id, deletedAt: n.deletedAt as number }));

	const blobIds = extractBlobIdsFromNotes(active);
	const blobRows = await getNoteBlobsByIds(blobIds);
	const blobs: SyncBlob[] = blobRows.map((row) => {
		const dataUrl = bytesToDataUrl(row.mime, row.bytes);
		const b64 = dataUrl.split(',')[1] ?? '';
		return {
			id: row.id,
			mime: row.mime,
			width: row.width,
			height: row.height,
			dataBase64: b64
		};
	});

	return {
		version: SYNC_BUNDLE_VERSION,
		exportedAt: Date.now(),
		notes: active,
		desk,
		tombstones,
		operations,
		blobs
	};
}

function normalizeSyncBlobs(
	raw: unknown,
	limits?: { maxBlobBase64Chars?: number; maxTotalBlobBase64Chars?: number }
): SyncBlob[] | string {
	if (raw == null) return [];
	if (!Array.isArray(raw)) return 'Blobs must be an array';
	if (raw.length > 5000) return 'Too many blobs in sync bundle';
	const maxBlobBase64Chars = limits?.maxBlobBase64Chars ?? MAX_SYNC_BLOB_BASE64_CHARS;
	const maxTotalBlobBase64Chars = limits?.maxTotalBlobBase64Chars ?? MAX_SYNC_BLOBS_BASE64_CHARS;
	const out: SyncBlob[] = [];
	const seenIds = new Set<string>();
	let totalBase64Chars = 0;
	for (let i = 0; i < raw.length; i++) {
		const row = raw[i];
		if (!isRecord(row)) return `Blob ${i + 1} is not an object`;
		const id = boundedId(row.id);
		const mime = normalizeBlobMime(asString(row.mime));
		const dataBase64 = asString(row.dataBase64).replace(/\s+/g, '');
		if (!id || !mime || !dataBase64) return `Blob ${i + 1} missing id/mime/dataBase64`;
		if (seenIds.has(id)) return `Duplicate blob id: ${id.slice(0, 40)}`;
		seenIds.add(id);
		if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 === 1) {
			return `Blob ${i + 1} has invalid base64 data`;
		}
		if (dataBase64.length > maxBlobBase64Chars) {
			return `Blob ${i + 1} is too large`;
		}
		totalBase64Chars += dataBase64.length;
		if (totalBase64Chars > maxTotalBlobBase64Chars) {
			return 'Image data in sync bundle is too large';
		}
		out.push({
			id,
			mime,
			width: clampNumber(row.width, 0, 0, MAX_CANVAS_ITEM_EDGE * 4),
			height: clampNumber(row.height, 0, 0, MAX_CANVAS_ITEM_EDGE * 4),
			dataBase64
		});
	}
	return out;
}

export function decodeSyncBlobs(blobs: SyncBlob[] | undefined): NoteBlob[] {
	if (!blobs?.length) return [];
	const decoded: NoteBlob[] = [];
	const created = Date.now();
	for (const row of blobs) {
		const parsed = dataUrlToBytes(`data:${row.mime};base64,${row.dataBase64}`);
		if (!parsed) throw new Error(`Invalid image data for blob ${row.id.slice(0, 16)}`);
		decoded.push({
			id: row.id,
			mime: parsed.mime,
			bytes: parsed.bytes,
			width: row.width,
			height: row.height,
			created
		});
	}
	return decoded;
}

export async function persistSyncBlobs(blobs: SyncBlob[] | undefined): Promise<number> {
	const decoded = decodeSyncBlobs(blobs);
	if (decoded.length > 0) await db.noteBlobs.bulkPut(decoded);
	return decoded.length;
}

function normalizeTombstones(raw: unknown): SyncTombstone[] | string {
	if (raw == null) return [];
	if (!Array.isArray(raw)) return 'Tombstones must be an array';
	if (raw.length > 5000) return 'Too many tombstones in sync bundle';
	const out: SyncTombstone[] = [];
	const seenIds = new Set<string>();
	for (let i = 0; i < raw.length; i++) {
		const row = raw[i];
		if (!isRecord(row)) return `Tombstone ${i + 1} is not an object`;
		const id = boundedId(row.id);
		const deletedAt = asNumber(row.deletedAt, NaN);
		if (!id || !Number.isFinite(deletedAt)) return `Tombstone ${i + 1} missing id/deletedAt`;
		if (seenIds.has(id)) return `Duplicate tombstone id: ${id.slice(0, 40)}`;
		seenIds.add(id);
		out.push({ id, deletedAt });
	}
	return out;
}

function normalizeOperations(raw: unknown): Operation[] | string {
	if (raw == null) return [];
	if (!Array.isArray(raw)) return 'Operations must be an array';
	if (raw.length > 10_000) return 'Too many operations in sync bundle';
	const out: Operation[] = [];
	const seenIds = new Set<string>();
	for (let index = 0; index < raw.length; index++) {
		const row = raw[index];
		if (!isRecord(row)) return `Operation ${index + 1} is not an object`;
		const id = boundedId(row.id);
		const sessionId = boundedId(row.sessionId);
		const type = asString(row.type).trim().slice(0, 100);
		if (Array.isArray(row.inputNoteIds) && row.inputNoteIds.length > MAX_OPERATION_NOTE_IDS) {
			return `Operation ${index + 1} has too many input notes`;
		}
		if (Array.isArray(row.outputNoteIds) && row.outputNoteIds.length > MAX_OPERATION_NOTE_IDS) {
			return `Operation ${index + 1} has too many output notes`;
		}
		const inputNoteIds = Array.isArray(row.inputNoteIds)
			? row.inputNoteIds
					.filter((noteId): noteId is string => typeof noteId === 'string')
					.map((noteId) => noteId.slice(0, MAX_ID_CHARS))
			: [];
		const outputNoteIds = Array.isArray(row.outputNoteIds)
			? row.outputNoteIds
					.filter((noteId): noteId is string => typeof noteId === 'string')
					.map((noteId) => noteId.slice(0, MAX_ID_CHARS))
			: [];
		if (!id || !type) return `Operation ${index + 1} missing id/type`;
		if (seenIds.has(id)) return `Duplicate operation id: ${id.slice(0, 40)}`;
		seenIds.add(id);
		const operation: Operation = {
			id,
			sessionId,
			type,
			inputNoteIds,
			outputNoteIds,
			created: asNumber(row.created, Date.now())
		};
		if (isRecord(row.payload)) {
			if (JSON.stringify(row.payload).length > MAX_OPERATION_PAYLOAD_CHARS) {
				return `Operation ${index + 1} payload is too large`;
			}
			operation.payload = { ...row.payload };
		}
		if (typeof row.revertedAt === 'number' && Number.isFinite(row.revertedAt)) {
			operation.revertedAt = row.revertedAt;
		}
		out.push(operation);
	}
	return out;
}

export function parseSyncBundle(
	raw: string,
	options?: {
		maxChars?: number;
		maxBlobBase64Chars?: number;
		maxTotalBlobBase64Chars?: number;
	}
): { ok: true; bundle: SyncBundle } | { ok: false; error: string } {
	if (raw.length > (options?.maxChars ?? SYNC_BUNDLE_MAX_CHARS)) {
		return { ok: false, error: 'Sync file too large' };
	}
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Invalid JSON' };
	}
	if (!data || typeof data !== 'object') {
		return { ok: false, error: 'Not a sync bundle' };
	}
	const obj = data as Record<string, unknown>;
	const version = obj.version;
	if (
		version !== SYNC_BUNDLE_VERSION &&
		version !== SYNC_BUNDLE_VERSION_V5 &&
		version !== SYNC_BUNDLE_VERSION_V4 &&
		version !== SYNC_BUNDLE_VERSION_V3 &&
		version !== SYNC_BUNDLE_VERSION_V2 &&
		version !== SYNC_BUNDLE_VERSION_V1
	) {
		return { ok: false, error: `Unsupported sync bundle version (${String(version)})` };
	}
	if (!Array.isArray(obj.notes)) {
		return { ok: false, error: 'Sync bundle missing notes array' };
	}
	if (obj.notes.length > 5000) {
		return { ok: false, error: 'Too many notes in sync bundle (max 5000)' };
	}

	const notes: Note[] = [];
	const noteIds = new Set<string>();
	for (let i = 0; i < obj.notes.length; i++) {
		const result = normalizeImportedNote(obj.notes[i], i);
		if (typeof result === 'string') return { ok: false, error: result };
		if (noteIds.has(result.id)) {
			return { ok: false, error: `Duplicate note id: ${result.id.slice(0, 40)}` };
		}
		noteIds.add(result.id);
		// JSON / vault-style imports must not invent soft-deletes via deletedAt.
		const active = { ...(result as Note & { deletedAt?: number }) };
		delete active.deletedAt;
		notes.push(active);
	}

	let desk: DeskSnapshot | undefined;
	if (
		version === SYNC_BUNDLE_VERSION ||
		version === SYNC_BUNDLE_VERSION_V5 ||
		version === SYNC_BUNDLE_VERSION_V4 ||
		version === SYNC_BUNDLE_VERSION_V3 ||
		version === SYNC_BUNDLE_VERSION_V2
	) {
		const deskResult = normalizeDesk(obj.desk);
		if (typeof deskResult === 'string') return { ok: false, error: deskResult };
		desk = deskResult;
	}

	let tombstones: SyncTombstone[] | undefined;
	if (
		version === SYNC_BUNDLE_VERSION ||
		version === SYNC_BUNDLE_VERSION_V5 ||
		version === SYNC_BUNDLE_VERSION_V4 ||
		version === SYNC_BUNDLE_VERSION_V3
	) {
		const tombResult = normalizeTombstones(obj.tombstones);
		if (typeof tombResult === 'string') return { ok: false, error: tombResult };
		tombstones = tombResult;
	}

	let operations: Operation[] | undefined;
	if (
		version === SYNC_BUNDLE_VERSION ||
		version === SYNC_BUNDLE_VERSION_V5 ||
		version === SYNC_BUNDLE_VERSION_V4
	) {
		const operationResult = normalizeOperations(obj.operations);
		if (typeof operationResult === 'string') return { ok: false, error: operationResult };
		operations = operationResult;
	}

	let blobs: SyncBlob[] | undefined;
	if (version === SYNC_BUNDLE_VERSION || version === SYNC_BUNDLE_VERSION_V5) {
		const blobResult = normalizeSyncBlobs(obj.blobs, options);
		if (typeof blobResult === 'string') return { ok: false, error: blobResult };
		blobs = blobResult;
	}

	return {
		ok: true,
		bundle: {
			version: version as SyncBundle['version'],
			exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
			notes,
			desk,
			tombstones,
			operations,
			blobs
		}
	};
}

async function stripCanvasForDeletedNotes(noteIds: string[]): Promise<void> {
	if (noteIds.length === 0) return;
	const items = await db.canvasItems.where('noteId').anyOf(noteIds).toArray();
	if (items.length === 0) return;
	const itemIds = items.map((item) => item.id);
	const [from, to] = await Promise.all([
		db.canvasEdges.where('fromItemId').anyOf(itemIds).toArray(),
		db.canvasEdges.where('toItemId').anyOf(itemIds).toArray()
	]);
	const edgeIds = [...new Set([...from, ...to].map((edge) => edge.id))];
	if (edgeIds.length > 0) await db.canvasEdges.bulkDelete(edgeIds);
	const elements = await db.canvasElements.toArray();
	const elementIds = elements
		.filter((element) => itemIds.some((itemId) => canvasElementBindsItem(element, itemId)))
		.map((element) => element.id);
	if (elementIds.length > 0) await db.canvasElements.bulkDelete(elementIds);
	await db.canvasItems.bulkDelete(itemIds);
}

/**
 * Merge remote bundle into local notes map.
 * Returns updated note list + conflict summary (LWW already chose winners).
 * Applies tombstones so deletes propagate across devices.
 */
export function mergeSyncBundle(
	localNotes: Note[],
	bundle: SyncBundle
): { notes: Note[]; summary: SyncMergeSummary } {
	const byId = new Map(localNotes.map((n) => [n.id, { ...n }]));
	const results: MergeResult[] = [];
	const conflicts: SyncConflict[] = [];
	let added = 0;
	let updated = 0;
	let unchanged = 0;
	let removed = 0;

	for (const remote of bundle.notes) {
		const local = byId.get(remote.id);
		if (!local) {
			byId.set(remote.id, { ...remote });
			added += 1;
			continue;
		}
		// Remote active note resurrects a locally soft-deleted note when newer.
		if (local.deletedAt != null) {
			if (remote.modified > local.deletedAt) {
				const rest = { ...local };
				delete rest.deletedAt;
				const resurrected = { ...rest, ...remote };
				delete resurrected.deletedAt;
				byId.set(remote.id, resurrected);
				updated += 1;
			}
			continue;
		}
		const merged = mergeNotesLww(local, remote);
		results.push(merged);
		if (hasConflicts(merged)) {
			conflicts.push(...merged.conflicts);
		}
		const changed =
			merged.note.modified !== local.modified ||
			JSON.stringify(merged.note) !== JSON.stringify(local);
		if (changed) {
			byId.set(remote.id, merged.note);
			updated += 1;
		} else {
			unchanged += 1;
		}
	}

	for (const tomb of bundle.tombstones ?? []) {
		const local = byId.get(tomb.id);
		if (!local) {
			byId.set(tomb.id, {
				id: tomb.id,
				title: 'Deleted',
				body: '',
				folder: '',
				tags: [],
				created: tomb.deletedAt,
				modified: tomb.deletedAt,
				pinned: 0,
				deletedAt: tomb.deletedAt
			});
			removed += 1;
			continue;
		}
		if (local.deletedAt != null) {
			if (tomb.deletedAt > local.deletedAt) {
				byId.set(tomb.id, { ...local, deletedAt: tomb.deletedAt });
			}
			continue;
		}
		if (tomb.deletedAt >= local.modified) {
			byId.set(tomb.id, {
				...local,
				deletedAt: tomb.deletedAt,
				modified: Math.max(local.modified, tomb.deletedAt)
			});
			removed += 1;
		}
		// else: local is newer than tombstone — keep / drop tombstone on next export
	}

	const notes = [...byId.values()].sort((a, b) => b.modified - a.modified);
	return {
		notes,
		summary: { added, updated, unchanged, removed, results, conflicts }
	};
}

type DeskIdbApplyResult = DeskApplySummary & {
	remappedDismissed: DismissedByCanvas;
};

/**
 * Apply remote desk onto local IndexedDB only (no localStorage dismissals).
 * Canvases keyed by folder; items remapped to local canvas ids.
 * Newer canvas.modified wins placement for a note; otherwise keep local.
 * Joins an ambient Dexie transaction when one already covers these tables.
 */
async function applyDeskIdbSnapshot(
	desk: DeskSnapshot,
	knownNoteIds: Set<string>,
	sessionId?: string
): Promise<DeskIdbApplyResult> {
	const localCanvases = sessionId
		? await db.canvases.where('sessionId').equals(sessionId).toArray()
		: await db.canvases.toArray();
	const localByFolder = new Map(localCanvases.map((c) => [c.folder, c]));
	/** folder → effective modified used for LWW placement */
	const folderModified = new Map(localCanvases.map((c) => [c.folder, c.modified]));
	let canvasesUpserted = 0;
	let itemsUpserted = 0;
	let itemsSkipped = 0;
	let edgesUpserted = 0;
	let edgesSkipped = 0;
	let elementsUpserted = 0;
	let elementsSkipped = 0;

	/** remote canvas id → local canvas id */
	const idMap = new Map<string, string>();
	/** remote canvas item id → local canvas item id */
	const itemIdMap = new Map<string, string>();

	for (const remote of desk.canvases) {
		const local = localByFolder.get(remote.folder);
		if (!local) {
			const canvas: Canvas = {
				id: newId(),
				folder: remote.folder,
				title: remote.title,
				created: remote.created,
				modified: remote.modified,
				sessionId
			};
			await db.canvases.put(canvas);
			idMap.set(remote.id, canvas.id);
			localByFolder.set(canvas.folder, canvas);
			folderModified.set(canvas.folder, canvas.modified);
			canvasesUpserted += 1;
			continue;
		}
		idMap.set(remote.id, local.id);
		if (remote.modified > local.modified) {
			await db.canvases.update(local.id, {
				title: remote.title,
				modified: remote.modified
			});
			folderModified.set(local.folder, remote.modified);
			canvasesUpserted += 1;
		}
	}

	const remoteCanvasById = new Map(desk.canvases.map((canvas) => [canvas.id, canvas]));
	const targetCanvasIds = [...new Set(idMap.values())];
	const existingItemRows =
		targetCanvasIds.length > 0
			? await db.canvasItems.where('canvasId').anyOf(targetCanvasIds).toArray()
			: [];
	const existingItemsByCanvas = new Map<string, Map<string, CanvasItem>>();
	for (const item of existingItemRows) {
		let byNote = existingItemsByCanvas.get(item.canvasId);
		if (!byNote) {
			byNote = new Map();
			existingItemsByCanvas.set(item.canvasId, byNote);
		}
		byNote.set(item.noteId, item);
	}
	const itemUpserts: CanvasItem[] = [];

	for (const remoteItem of desk.items) {
		if (!knownNoteIds.has(remoteItem.noteId)) {
			itemsSkipped += 1;
			continue;
		}
		const localCanvasId = idMap.get(remoteItem.canvasId);
		const remoteCanvas = remoteCanvasById.get(remoteItem.canvasId);
		if (!localCanvasId || !remoteCanvas) {
			itemsSkipped += 1;
			continue;
		}
		const localMod = folderModified.get(remoteCanvas.folder) ?? 0;
		const remoteNewer = remoteCanvas.modified >= localMod;

		let byNote = existingItemsByCanvas.get(localCanvasId);
		if (!byNote) {
			byNote = new Map();
			existingItemsByCanvas.set(localCanvasId, byNote);
		}
		const existing = byNote.get(remoteItem.noteId);

		if (!existing) {
			// Only insert remote-only placements when remote canvas wins LWW.
			// Otherwise an older bundle can resurrect cards the user already removed.
			if (!remoteNewer) {
				itemsSkipped += 1;
				continue;
			}
			const localItemId = newId();
			const next: CanvasItem = {
				id: localItemId,
				canvasId: localCanvasId,
				noteId: remoteItem.noteId,
				x: remoteItem.x,
				y: remoteItem.y,
				w: remoteItem.w,
				h: remoteItem.h,
				color: remoteItem.color
			};
			itemUpserts.push(next);
			byNote.set(remoteItem.noteId, next);
			itemIdMap.set(remoteItem.id, localItemId);
			itemsUpserted += 1;
			continue;
		}

		itemIdMap.set(remoteItem.id, existing.id);
		if (remoteNewer) {
			const next: CanvasItem = {
				...existing,
				x: remoteItem.x,
				y: remoteItem.y,
				w: remoteItem.w,
				h: remoteItem.h,
				color: remoteItem.color
			};
			itemUpserts.push(next);
			byNote.set(remoteItem.noteId, next);
			itemsUpserted += 1;
		} else {
			itemsSkipped += 1;
		}
	}
	if (itemUpserts.length > 0) await db.canvasItems.bulkPut(itemUpserts);

	for (const remoteCanvas of desk.canvases) {
		const localCanvas = localByFolder.get(remoteCanvas.folder);
		const localCanvasId = idMap.get(remoteCanvas.id);
		if (!localCanvas || !localCanvasId || remoteCanvas.modified < localCanvas.modified) continue;
		const bowls = (remoteCanvas.bowls ?? [])
			.map((bowl) => ({
				...bowl,
				id: newId(),
				itemIds: bowl.itemIds
					.map((itemId) => itemIdMap.get(itemId))
					.filter((itemId): itemId is string => Boolean(itemId))
			}))
			.filter((bowl) => bowl.itemIds.length >= 2);
		await db.canvases.update(localCanvasId, { bowls });
	}

	const existingEdgeRows =
		targetCanvasIds.length > 0
			? await db.canvasEdges.where('canvasId').anyOf(targetCanvasIds).toArray()
			: [];
	const edgeKeys = new Set(
		existingEdgeRows.map((edge) => JSON.stringify([edge.canvasId, edge.fromItemId, edge.toItemId]))
	);
	const edgeUpserts: CanvasEdge[] = [];
	for (const remoteEdge of desk.edges ?? []) {
		const localCanvasId = idMap.get(remoteEdge.canvasId);
		const fromLocal = itemIdMap.get(remoteEdge.fromItemId);
		const toLocal = itemIdMap.get(remoteEdge.toItemId);
		if (!localCanvasId || !fromLocal || !toLocal || fromLocal === toLocal) {
			edgesSkipped += 1;
			continue;
		}
		const edgeKey = JSON.stringify([localCanvasId, fromLocal, toLocal]);
		if (edgeKeys.has(edgeKey)) {
			edgesSkipped += 1;
			continue;
		}
		edgeUpserts.push({
			id: newId(),
			canvasId: localCanvasId,
			fromItemId: fromLocal,
			toItemId: toLocal,
			created: remoteEdge.created
		});
		edgeKeys.add(edgeKey);
		edgesUpserted += 1;
	}
	if (edgeUpserts.length > 0) await db.canvasEdges.bulkPut(edgeUpserts);

	const existingElementRows =
		targetCanvasIds.length > 0
			? await db.canvasElements.where('canvasId').anyOf(targetCanvasIds).toArray()
			: [];
	const elementFingerprint = (element: CanvasElement) =>
		JSON.stringify({
			canvasId: element.canvasId,
			kind: element.kind,
			start: element.start,
			end: element.end,
			label: element.label ?? '',
			color: element.color ?? 'green',
			stroke: element.stroke ?? 'solid',
			zIndex: element.zIndex
		});
	const elementKeys = new Set(existingElementRows.map(elementFingerprint));
	const elementUpserts: CanvasElement[] = [];
	for (const remoteElement of desk.elements ?? []) {
		const localCanvasId = idMap.get(remoteElement.canvasId);
		const remoteCanvas = remoteCanvasById.get(remoteElement.canvasId);
		if (!localCanvasId || !remoteCanvas) {
			elementsSkipped += 1;
			continue;
		}
		const localMod = folderModified.get(remoteCanvas.folder) ?? 0;
		if (remoteCanvas.modified < localMod) {
			elementsSkipped += 1;
			continue;
		}
		const next = remapCanvasElement(remoteElement, localCanvasId, itemIdMap, newId());
		if (!next) {
			elementsSkipped += 1;
			continue;
		}
		const key = elementFingerprint(next);
		if (elementKeys.has(key)) {
			elementsSkipped += 1;
			continue;
		}
		elementKeys.add(key);
		elementUpserts.push(next);
		elementsUpserted += 1;
	}
	if (elementUpserts.length > 0) await db.canvasElements.bulkPut(elementUpserts);

	const remappedDismissed: DismissedByCanvas = {};
	for (const [remoteCanvasId, noteIds] of Object.entries(desk.dismissed)) {
		const localId = idMap.get(remoteCanvasId);
		if (!localId) continue;
		remappedDismissed[localId] = noteIds;
	}

	return {
		canvasesUpserted,
		itemsUpserted,
		itemsSkipped,
		edgesUpserted,
		edgesSkipped,
		elementsUpserted,
		elementsSkipped,
		remappedDismissed
	};
}

/**
 * Apply remote desk onto local IndexedDB, then merge dismissals into localStorage.
 */
export async function applyDeskSnapshot(
	desk: DeskSnapshot,
	knownNoteIds: Set<string>,
	sessionId?: string
): Promise<DeskApplySummary> {
	const { remappedDismissed, ...summary } = await applyDeskIdbSnapshot(
		desk,
		knownNoteIds,
		sessionId
	);
	importDismissedMap(remappedDismissed);
	return summary;
}

/**
 * Persist merged notes + optional desk in one IndexedDB transaction.
 * Soft-deleted notes are written (tombstones) and stripped from canvases.
 * localStorage dismissals apply only after the transaction commits.
 */
export async function persistMergedSync(
	plainNotes: Note[],
	desk: DeskSnapshot | undefined,
	knownNoteIds: Set<string>,
	sessionId?: string,
	operations: Operation[] = [],
	blobs: SyncBlob[] = []
): Promise<{ desk?: DeskApplySummary; operationsUpserted: number; blobsUpserted?: number }> {
	let deskSummary: DeskApplySummary | undefined;
	let remappedDismissed: DismissedByCanvas = {};
	let operationsUpserted = 0;
	let blobsUpserted = 0;
	const deletedIds = plainNotes.filter((n) => n.deletedAt != null).map((n) => n.id);
	const deletedSet = new Set(deletedIds);
	// Decode before opening the transaction; persist pixels atomically with their note references.
	const decodedBlobs = decodeSyncBlobs(blobs);

	await db.transaction(
		'rw',
		[
			db.notes,
			db.canvases,
			db.canvasItems,
			db.canvasEdges,
			db.canvasElements,
			db.operations,
			db.noteBlobs
		],
		async () => {
			const operationIdMap = new Map<string, string>();
			const existingOperations = await db.operations.bulkGet(
				operations.map((operation) => operation.id)
			);
			for (let index = 0; index < operations.length; index++) {
				const operation = operations[index]!;
				const existing = existingOperations[index];
				if (existing && sessionId && existing.sessionId !== sessionId) {
					operationIdMap.set(operation.id, newId());
				}
			}
			for (const note of plainNotes) {
				if (note.operationId && operationIdMap.has(note.operationId)) {
					note.operationId = operationIdMap.get(note.operationId);
				}
			}
			if (decodedBlobs.length > 0) {
				await db.noteBlobs.bulkPut(decodedBlobs);
				blobsUpserted = decodedBlobs.length;
			}
			await db.notes.bulkPut(plainNotes);
			const mappedOperations = operations.map((operation): Operation => ({
				...operation,
				id: operationIdMap.get(operation.id) ?? operation.id,
				sessionId: sessionId ?? operation.sessionId,
				inputNoteIds: [...operation.inputNoteIds],
				outputNoteIds: [...operation.outputNoteIds],
				...(operation.payload ? { payload: { ...operation.payload } } : {})
			}));
			if (mappedOperations.length > 0) {
				await db.operations.bulkPut(mappedOperations);
				operationsUpserted = mappedOperations.length;
			}
			await stripCanvasForDeletedNotes(deletedIds);
			if (desk) {
				const activeIds = new Set([...knownNoteIds].filter((id) => !deletedSet.has(id)));
				const result = await applyDeskIdbSnapshot(desk, activeIds, sessionId);
				const { remappedDismissed: remapped, ...summary } = result;
				deskSummary = summary;
				remappedDismissed = remapped;
			}
		}
	);

	if (Object.keys(remappedDismissed).length > 0) {
		importDismissedMap(remappedDismissed);
	}

	return { desk: deskSummary, operationsUpserted, blobsUpserted };
}

export async function downloadSyncBundle(
	notes: Note[],
	filename = 'mash-sync-bundle.json',
	sessionId?: string
) {
	const bundle = await buildSyncBundle(notes, sessionId);
	const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	// Defer revoke — some browsers cancel the download if revoked synchronously.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Human-readable conflict list for toasts / dialogs. */
export function formatConflictSummary(conflicts: SyncConflict[], limit = 6): string {
	if (conflicts.length === 0) return '';
	const lines = conflicts.slice(0, limit).map((c) => {
		const short = c.noteId.slice(0, 8);
		return `· ${short}… ${c.field} → kept ${c.chosen}`;
	});
	const more = conflicts.length > limit ? `\n· …and ${conflicts.length - limit} more` : '';
	return lines.join('\n') + more;
}

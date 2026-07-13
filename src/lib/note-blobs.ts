/**
 * Out-of-line note image blobs (IndexedDB) referenced as mash-blob:<id> in note bodies.
 */
import { db, newId } from './db';
import { composeEmbeddedNoteImage, parseEmbeddedNoteImage } from './markdown';
import type { Note, NoteBlob, NoteBlobMime } from './types';

export const MASH_BLOB_SCHEME = 'mash-blob:';

/** UUID-ish ids only — no path segments or schemes. */
const BLOB_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;

export function composeMashBlobSrc(id: string): string {
	return `${MASH_BLOB_SCHEME}${id}`;
}

export function isMashBlobRef(src: string | undefined | null): boolean {
	if (!src) return false;
	const trimmed = src.trim();
	if (!trimmed.toLowerCase().startsWith(MASH_BLOB_SCHEME)) return false;
	const id = trimmed.slice(MASH_BLOB_SCHEME.length);
	return BLOB_ID_RE.test(id);
}

export function blobIdFromRef(src: string): string | null {
	if (!isMashBlobRef(src)) return null;
	return src.trim().slice(MASH_BLOB_SCHEME.length);
}

export function imageNoteBodyFromBlob(blobId: string, alt: string, caption = ''): string {
	return composeEmbeddedNoteImage(
		alt.slice(0, 200) || 'Image',
		composeMashBlobSrc(blobId),
		caption
	);
}

/** All mash-blob ids referenced anywhere in a body (leading + inline). */
export function extractBlobIdsFromBody(body: string): string[] {
	if (!body || !body.includes(MASH_BLOB_SCHEME)) return [];
	const ids: string[] = [];
	const seen = new Set<string>();
	const re = /mash-blob:([A-Za-z0-9_-]{8,128})/gi;
	for (const match of body.matchAll(re)) {
		const id = match[1];
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function extractBlobIdsFromNotes(notes: Iterable<Note>): Set<string> {
	const ids = new Set<string>();
	for (const note of notes) {
		for (const id of extractBlobIdsFromBody(note.body)) ids.add(id);
	}
	return ids;
}

/**
 * Blob ids still needed by live notes. Soft-deleted rows keep their body text for
 * tombstone retention but do not pin binary payloads (pixels free on soft-delete
 * once no active note still references them).
 */
export function extractBlobIdsFromActiveNotes(
	notes: Iterable<Note>,
	opts?: { ignoreNoteIds?: ReadonlySet<string> | readonly string[] }
): Set<string> {
	const ignore =
		opts?.ignoreNoteIds == null
			? null
			: opts.ignoreNoteIds instanceof Set
				? opts.ignoreNoteIds
				: new Set(opts.ignoreNoteIds);
	const ids = new Set<string>();
	for (const note of notes) {
		if (note.deletedAt != null) continue;
		if (ignore?.has(note.id)) continue;
		for (const id of extractBlobIdsFromBody(note.body)) ids.add(id);
	}
	return ids;
}

export function normalizeBlobMime(mime: string): NoteBlobMime | null {
	const m = mime.trim().toLowerCase();
	if (m === 'image/jpg') return 'image/jpeg';
	if (m === 'image/png' || m === 'image/jpeg' || m === 'image/webp' || m === 'image/gif') {
		return m;
	}
	return null;
}

export function dataUrlToBytes(dataUrl: string): { mime: NoteBlobMime; bytes: ArrayBuffer } | null {
	const trimmed = dataUrl.trim();
	const match = trimmed.match(DATA_URL_RE);
	if (!match) return null;
	const mime = normalizeBlobMime(match[1] ?? '');
	if (!mime) return null;
	const b64 = (match[2] ?? '').replace(/\s+/g, '');
	try {
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return { mime, bytes: bytes.buffer };
	} catch {
		return null;
	}
}

export function bytesToDataUrl(mime: NoteBlobMime, bytes: ArrayBuffer): string {
	const view = new Uint8Array(bytes);
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < view.length; i += chunk) {
		binary += String.fromCharCode(...view.subarray(i, i + chunk));
	}
	return `data:${mime};base64,${btoa(binary)}`;
}

export async function putNoteBlob(input: {
	mime: string;
	bytes: ArrayBuffer;
	width: number;
	height: number;
	id?: string;
}): Promise<NoteBlob> {
	const mime = normalizeBlobMime(input.mime);
	if (!mime) throw new Error(`Unsupported blob mime: ${input.mime}`);
	const row: NoteBlob = {
		id: input.id?.trim() || newId(),
		mime,
		bytes: input.bytes,
		width: Math.max(0, Math.round(input.width)),
		height: Math.max(0, Math.round(input.height)),
		created: Date.now()
	};
	await db.noteBlobs.put(row);
	return row;
}

export async function putNoteBlobFromDataUrl(
	dataUrl: string,
	dims?: { width: number; height: number }
): Promise<NoteBlob> {
	const parsed = dataUrlToBytes(dataUrl);
	if (!parsed) throw new Error('Invalid image data URL');
	let width = dims?.width ?? 0;
	let height = dims?.height ?? 0;
	if ((!width || !height) && typeof createImageBitmap === 'function') {
		try {
			const blob = new Blob([parsed.bytes], { type: parsed.mime });
			const bmp = await createImageBitmap(blob);
			width = bmp.width;
			height = bmp.height;
			bmp.close();
		} catch {
			/* leave 0 */
		}
	}
	return putNoteBlob({
		mime: parsed.mime,
		bytes: parsed.bytes,
		width,
		height
	});
}

export async function getNoteBlob(id: string): Promise<NoteBlob | undefined> {
	return db.noteBlobs.get(id);
}

export async function deleteNoteBlob(id: string): Promise<void> {
	await db.noteBlobs.delete(id);
	releaseCachedBlobUrl(composeMashBlobSrc(id));
}

export async function getNoteBlobsByIds(ids: Iterable<string>): Promise<NoteBlob[]> {
	const list = [...new Set([...ids].filter(Boolean))];
	if (list.length === 0) return [];
	const rows = await db.noteBlobs.bulkGet(list);
	return rows.filter((r): r is NoteBlob => Boolean(r));
}

// -----------------------------------------------------------------------------
// Display URL cache (object URLs for mash-blob: refs)
// -----------------------------------------------------------------------------

type CacheEntry = { url: string; refs: number };

const urlCache = new Map<string, CacheEntry>();
/** In-flight loads so concurrent resolvers share one object URL. */
const inflightLoads = new Map<string, Promise<CacheEntry | null>>();

function releaseCachedBlobUrl(src: string) {
	const key = src.trim();
	const entry = urlCache.get(key);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs <= 0) {
		URL.revokeObjectURL(entry.url);
		urlCache.delete(key);
	}
}

/** Resolve a displayable img src (data URL pass-through or blob: object URL). */
export async function resolveDisplayUrl(src: string): Promise<string | null> {
	const trimmed = src.trim();
	if (!trimmed) return null;
	if (trimmed.toLowerCase().startsWith('data:image/')) return trimmed;

	const id = blobIdFromRef(trimmed);
	if (!id) return null;

	const existing = urlCache.get(trimmed);
	if (existing) {
		existing.refs += 1;
		return existing.url;
	}

	let load = inflightLoads.get(trimmed);
	if (!load) {
		load = (async (): Promise<CacheEntry | null> => {
			try {
				const raced = urlCache.get(trimmed);
				if (raced) return raced;
				const row = await getNoteBlob(id);
				if (!row) return null;
				const after = urlCache.get(trimmed);
				if (after) return after;
				const blob = new Blob([row.bytes], { type: row.mime });
				const url = URL.createObjectURL(blob);
				const entry: CacheEntry = { url, refs: 0 };
				urlCache.set(trimmed, entry);
				return entry;
			} finally {
				inflightLoads.delete(trimmed);
			}
		})();
		inflightLoads.set(trimmed, load);
	}

	const entry = await load;
	if (!entry) return null;
	entry.refs += 1;
	return entry.url;
}

export function releaseDisplayUrl(src: string): void {
	if (!isMashBlobRef(src)) return;
	releaseCachedBlobUrl(src.trim());
}

export function clearBlobUrlCache(): void {
	for (const entry of urlCache.values()) {
		URL.revokeObjectURL(entry.url);
	}
	urlCache.clear();
	inflightLoads.clear();
}

/** For exporters that need a data URL (PDF / board image). */
export async function resolveToDataUrl(src: string): Promise<string | null> {
	const trimmed = src.trim();
	if (trimmed.toLowerCase().startsWith('data:image/')) return trimmed;
	const id = blobIdFromRef(trimmed);
	if (!id) return null;
	const row = await getNoteBlob(id);
	if (!row) return null;
	return bytesToDataUrl(row.mime, row.bytes);
}

// -----------------------------------------------------------------------------
// Migration + GC
// -----------------------------------------------------------------------------

/**
 * Rewrite a single note body that embeds a leading data-URL image into a mash-blob ref.
 * Returns the updated body, or null if no migration applied.
 */
export async function migrateLeadingDataUrlBody(body: string): Promise<string | null> {
	const embedded = parseEmbeddedNoteImage(body);
	if (!embedded) return null;
	if (!embedded.src.toLowerCase().startsWith('data:image/')) return null;
	const blob = await putNoteBlobFromDataUrl(embedded.src);
	return composeEmbeddedNoteImage(embedded.alt, composeMashBlobSrc(blob.id), embedded.caption);
}

/**
 * Migrate all notes that still embed data-URL leading images.
 * Yields every `batchSize` notes so bootstrap stays responsive.
 */
export async function migrateDataUrlBodiesToBlobs(options?: {
	batchSize?: number;
}): Promise<{ migrated: number }> {
	const batchSize = options?.batchSize ?? 20;
	const notes = await db.notes.toArray();
	let migrated = 0;
	for (let i = 0; i < notes.length; i++) {
		const note = notes[i]!;
		if (!note.body.includes('data:image')) continue;
		try {
			const next = await migrateLeadingDataUrlBody(note.body);
			if (!next || next === note.body) continue;
			await db.notes.update(note.id, { body: next, modified: note.modified });
			migrated++;
		} catch (e) {
			console.error('Blob migration failed for note', note.id, e);
		}
		if (i > 0 && i % batchSize === 0) {
			await new Promise((r) => setTimeout(r, 0));
		}
	}
	return { migrated };
}

/** Delete blob rows not referenced by any *active* note body. */
export async function gcOrphanNoteBlobs(): Promise<number> {
	const notes = await db.notes.toArray();
	const referenced = extractBlobIdsFromActiveNotes(notes);
	const all = await db.noteBlobs.toArray();
	const orphans = all.filter((b) => !referenced.has(b.id));
	if (orphans.length === 0) return 0;
	await db.noteBlobs.bulkDelete(orphans.map((b) => b.id));
	for (const b of orphans) releaseCachedBlobUrl(composeMashBlobSrc(b.id));
	return orphans.length;
}

/**
 * Drop candidate blob ids that no active note still references.
 * Safe after soft-delete, body replace/rotate, or hard purge of notes.
 *
 * `ignoreNoteIds` skips notes whose IDB body is stale (e.g. rotate already
 * rewrote the in-memory body but persist has not flushed yet).
 */
export async function deleteBlobIdsIfUnreferenced(
	candidateIds: Iterable<string>,
	opts?: { ignoreNoteIds?: readonly string[] }
): Promise<number> {
	const candidates = [...new Set([...candidateIds].filter(Boolean))];
	if (candidates.length === 0) return 0;
	const notes = await db.notes.toArray();
	const referenced = extractBlobIdsFromActiveNotes(notes, {
		ignoreNoteIds: opts?.ignoreNoteIds
	});
	let deleted = 0;
	for (const id of candidates) {
		if (referenced.has(id)) continue;
		await deleteNoteBlob(id);
		deleted++;
	}
	return deleted;
}

/** After soft-delete, drop blobs only referenced by that note (if no active notes use them). */
export async function gcBlobsAfterNoteDelete(deletedBody: string): Promise<void> {
	await deleteBlobIdsIfUnreferenced(extractBlobIdsFromBody(deletedBody));
}

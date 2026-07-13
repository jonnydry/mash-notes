/**
 * Peel hygiene — ingredients tray vs kept pantry.
 * Desk chips stay temporary; Kept notes are the durable pantry without a second-brain feel.
 */
import type { Note } from './types';

/** What the notes-mode peel is showing. */
export type PeelScopeFilter = 'ingredients' | 'desk' | 'kept';

export type PeelScopeCounts = {
	desk: number;
	kept: number;
	total: number;
};

/** Scratch / session cards (and legacy notes without kept scope). */
export function isDeskIngredient(note: Note): boolean {
	if (note.deletedAt != null) return false;
	return note.scope !== 'kept';
}

export function isKeptPantryNote(note: Note): boolean {
	if (note.deletedAt != null) return false;
	return note.scope === 'kept';
}

export function peelScopeCounts(notes: readonly Note[]): PeelScopeCounts {
	let desk = 0;
	let kept = 0;
	for (const note of notes) {
		if (note.deletedAt != null) continue;
		if (note.scope === 'kept') kept++;
		else desk++;
	}
	return { desk, kept, total: desk + kept };
}

export function filterNotesByPeelScope(notes: readonly Note[], scope: PeelScopeFilter): Note[] {
	if (scope === 'desk') return notes.filter(isDeskIngredient);
	if (scope === 'kept') return notes.filter(isKeptPantryNote);
	return [...notes];
}

/**
 * Desk ingredients first (newest), then kept pantry (newest).
 * Permanent welcome stays at the top of whichever group it belongs to.
 */
export function sortNotesForPeel(notes: readonly Note[]): Note[] {
	return [...notes].sort((a, b) => {
		const aSystem = a.system === 'mash-team-welcome';
		const bSystem = b.system === 'mash-team-welcome';
		if (aSystem !== bSystem) return aSystem ? -1 : 1;
		const aKept = a.scope === 'kept' ? 1 : 0;
		const bKept = b.scope === 'kept' ? 1 : 0;
		if (aKept !== bKept) return aKept - bKept;
		if (a.pinned !== b.pinned) return b.pinned - a.pinned;
		return b.modified - a.modified;
	});
}

export function peelScopeSubtitle(counts: PeelScopeCounts, scope: PeelScopeFilter): string {
	if (scope === 'desk') {
		return counts.desk === 1 ? '1 on this desk' : `${counts.desk} on this desk`;
	}
	if (scope === 'kept') {
		return counts.kept === 1 ? '1 kept on this device' : `${counts.kept} kept on this device`;
	}
	const deskPart = counts.desk === 1 ? '1 on desk' : `${counts.desk} on desk`;
	const keptPart = counts.kept === 1 ? '1 kept' : `${counts.kept} kept`;
	if (counts.kept === 0) return deskPart;
	if (counts.desk === 0) return keptPart;
	return `${deskPart} · ${keptPart}`;
}

/** Prefer desk ingredients, then kept, when ranking search hits already limited to the library. */
export function rankSearchIdsForPeel(
	ids: readonly string[],
	notesById: ReadonlyMap<string, Note>
): string[] {
	return [...ids].sort((aId, bId) => {
		const a = notesById.get(aId);
		const b = notesById.get(bId);
		if (!a && !b) return 0;
		if (!a) return 1;
		if (!b) return -1;
		const aKept = a.scope === 'kept' ? 1 : 0;
		const bKept = b.scope === 'kept' ? 1 : 0;
		if (aKept !== bKept) return aKept - bKept;
		return b.modified - a.modified;
	});
}

/** Merge session notes with the kept pantry (unique by id; session row wins). */
export function mergeSessionAndKeptPantry(sessionNotes: Note[], keptNotes: Note[]): Note[] {
	const byId = new Map<string, Note>();
	for (const note of keptNotes) {
		if (note.deletedAt != null) continue;
		byId.set(note.id, note);
	}
	for (const note of sessionNotes) {
		if (note.deletedAt != null) continue;
		byId.set(note.id, note);
	}
	return sortNotesForPeel([...byId.values()]);
}

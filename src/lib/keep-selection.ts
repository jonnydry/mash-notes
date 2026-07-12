/**
 * Mid-desk "Keep on this device" — promote scratch session notes without Finish.
 * Completes intentional persistence: desk ingredients stay temporary until kept.
 */
import type { Note } from './types';

/** Notes in the selection that are still session-scoped (not already kept). */
export function keepableNoteIds(
	selectedIds: readonly string[],
	notesById: ReadonlyMap<string, Note>
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of selectedIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		const note = notesById.get(id);
		if (!note || note.deletedAt != null) continue;
		if (note.system) continue;
		// Already durable
		if (note.scope === 'kept') continue;
		out.push(id);
	}
	return out;
}

export function keepSelectionToast(count: number): string {
	if (count <= 0) return 'Nothing new to keep';
	if (count === 1) return 'Kept 1 card on this device';
	return `Kept ${count} cards on this device`;
}

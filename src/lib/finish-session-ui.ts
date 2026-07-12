/**
 * Finish takeaway export/commit + desk switch/restore helpers.
 */
import type { CanvasEdge, CanvasItem, Note, Session } from './types';
import {
	createFinishSnapshot,
	noteIdsForFinishScope,
	notesForFinishScope,
	type FinishDraft,
	type FinishExportKind,
	type FinishScope,
	type FinishSnapshot
} from './finish-model';
import { combineNotes, copyText, exportNotesMarkdown, printSequenceAsPdf, slugifyFilename } from './mash';
import { sessionLifecycleLabel } from './session-lifecycle';

export type FinishSessionUiDeps = {
	getFinishSnapshot: () => FinishSnapshot | null;
	setFinishSnapshot: (s: FinishSnapshot | null) => void;
	getActiveSession: () => Session | null;
	getNotes: () => Note[];
	getNotesById: () => Map<string, Note>;
	getCanvasItems: () => CanvasItem[];
	getCanvasEdges: () => CanvasEdge[];
	getSelectionIds: () => string[];
	getOperations: () => import('./types').Operation[];
	flushPendingSaveAsync: () => Promise<void>;
	getWriteError: () => string;
	exportSyncBundle: () => Promise<void>;
	keepTakeaway: (noteIds: string[]) => Promise<Note[]>;
	keepActive: (now?: number) => Promise<Session | null | undefined>;
	clearActive: () => Promise<Session | null | undefined>;
	switchTo: (id: string) => Promise<unknown>;
	restore: (id: string) => Promise<Session | null | undefined>;
	createScratch: () => Promise<Session>;
	applyPromotedNotes: (notes: Note[]) => void;
	setNotes: (notes: Note[]) => void;
	loadNotes: () => Promise<void>;
	loadContextCanvas: (key: string, sessionId?: string) => Promise<void>;
	getCanvasKey: () => string;
	prepareSessionSwitch: () => Promise<void>;
	setSessionPanelOpen: (open: boolean) => void;
	flashToast: (msg: string, ms?: number) => void;
	askConfirm: (opts: {
		title: string;
		message: string;
		confirmLabel?: string;
		danger?: boolean;
		action: () => void | Promise<void>;
	}) => void;
	offerPersistentStorageOnce: () => void | Promise<void>;
	getTheme: () => 'light' | 'dark';
};

export function createFinishSessionUi(deps: FinishSessionUiDeps) {
	async function runFinishExport(kind: FinishExportKind, scope: FinishScope) {
		const snapshot = deps.getFinishSnapshot();
		if (!snapshot) return { ok: false, message: 'This desk is not ready to export.' };
		await deps.flushPendingSaveAsync();
		const notes = notesForFinishScope(snapshot, scope, deps.getNotesById());
		if (notes.length === 0) return { ok: false, message: 'There are no cards in this takeaway.' };
		const countLabel = `${notes.length} card${notes.length === 1 ? '' : 's'}`;

		try {
			if (kind === 'copy-markdown') {
				let copied = false;
				try {
					copied = await copyText(combineNotes(notes));
				} catch {
					copied = false;
				}
				return copied
					? { ok: true, message: `Copied ${countLabel} as Markdown.` }
					: { ok: false, message: 'Clipboard unavailable. Download Markdown instead.' };
			}
			if (kind === 'download-markdown') {
				const deskName = slugifyFilename(deps.getActiveSession()?.title ?? 'mash-desk');
				exportNotesMarkdown(notes, `${deskName}-${scope}.md`);
				return { ok: true, message: `Downloaded ${countLabel} as Markdown.` };
			}
			if (kind === 'pdf') {
				const opened = printSequenceAsPdf(
					notes,
					`${deps.getActiveSession()?.title ?? 'MASH desk'} · ${countLabel}`
				);
				return opened
					? { ok: true, message: `Opened ${countLabel} for printing or PDF.` }
					: { ok: false, message: 'Could not prepare the printable PDF.' };
			}
			if (kind === 'board-image') {
				const { loadBoardImageExporter } = await import('$lib/lazy-board-image');
				const { downloadBoardImage } = await loadBoardImageExporter();
				const result = await downloadBoardImage({
					noteIds: notes.map((note) => note.id),
					notesById: deps.getNotesById(),
					items: deps.getCanvasItems(),
					edges: deps.getCanvasEdges(),
					theme: deps.getTheme(),
					filename: `${slugifyFilename(deps.getActiveSession()?.title ?? 'mash-desk')}-${scope}-board.png`
				});
				return {
					ok: true,
					message: `Downloaded ${result.cardCount} card${result.cardCount === 1 ? '' : 's'} as a ${result.width} × ${result.height} PNG${result.downscaled ? ' (safely downscaled)' : ''}.`
				};
			}

			await deps.exportSyncBundle();
			return {
				ok: true,
				message: `Downloaded the whole desk with ${notes.length} card${notes.length === 1 ? '' : 's'} and result history.`
			};
		} catch (error) {
			console.error('Finish export failed', error);
			return { ok: false, message: 'That export did not finish. Your desk is unchanged.' };
		}
	}

	async function commitFinishNow(draft: FinishDraft) {
		const snapshot = deps.getFinishSnapshot();
		const session = deps.getActiveSession();
		if (!snapshot || !session || snapshot.sessionId !== session.id) {
			return { ok: false, message: 'This desk changed. Reopen Finish and try again.' };
		}
		const mutatesStorage = draft.keepTakeaway || draft.disposition !== 'leave';
		await deps.flushPendingSaveAsync();
		if (mutatesStorage && deps.getWriteError()) {
			return {
				ok: false,
				message: 'Mash could not update local storage. Copy or download your work, then retry.'
			};
		}

		let promotedCount = 0;
		if (draft.keepTakeaway && draft.disposition !== 'keep-desk') {
			const noteIds = noteIdsForFinishScope(snapshot, draft.scope);
			const promoted = await deps.keepTakeaway(noteIds);
			promotedCount = promoted.length;
			deps.applyPromotedNotes(promoted);
		}

		if (draft.disposition === 'keep-desk') {
			const keptAt = Date.now();
			const kept = await deps.keepActive(keptAt);
			if (!kept) return { ok: false, message: 'Mash could not keep this desk.' };
			deps.setNotes(
				deps.getNotes().map((note) => ({
					...note,
					scope: 'kept' as const,
					keptAt: note.keptAt ?? keptAt
				}))
			);
			deps.setSessionPanelOpen(false);
			deps.flashToast(`Kept “${kept.title}” on this device`, 3600);
			await deps.offerPersistentStorageOnce();
			return { ok: true, message: `Kept the entire desk on this device.` };
		}

		if (draft.disposition === 'clear') {
			const title = session.title;
			await deps.prepareSessionSwitch();
			const created = await deps.clearActive();
			await deps.loadNotes();
			if (created) await deps.loadContextCanvas(deps.getCanvasKey(), created.id);
			deps.setSessionPanelOpen(false);
			const keptPart =
				promotedCount > 0 ? `Kept ${promotedCount} card${promotedCount === 1 ? '' : 's'} · ` : '';
			deps.flashToast(`${keptPart}“${title}” moved to Recently cleared for 7 days`, 4600);
			return { ok: true, message: `${keptPart}${title} is recoverable for 7 days.` };
		}

		deps.setSessionPanelOpen(false);
		const lifecycle = sessionLifecycleLabel(session, Date.now());
		deps.flashToast(
			promotedCount > 0
				? `Kept ${promotedCount} card${promotedCount === 1 ? '' : 's'} · ${lifecycle}`
				: lifecycle,
			3600
		);
		return {
			ok: true,
			message:
				promotedCount > 0
					? `Kept ${promotedCount} card${promotedCount === 1 ? '' : 's'}; the desk remains scratch.`
					: `The desk remains unchanged. ${lifecycle}.`
		};
	}

	async function runFinishCommit(draft: FinishDraft) {
		if (draft.disposition !== 'clear') return commitFinishNow(draft);
		const snapshot = deps.getFinishSnapshot();
		const title = deps.getActiveSession()?.title ?? 'this desk';
		const takeawayCount = snapshot ? noteIdsForFinishScope(snapshot, draft.scope).length : 0;
		const keepMessage = draft.keepTakeaway
			? ` Keep ${takeawayCount} takeaway card${takeawayCount === 1 ? '' : 's'} on this device.`
			: '';
		deps.askConfirm({
			title: 'Clear this desk?',
			message: `“${title}” will leave your active desks.${keepMessage} You can restore the desk from Recently cleared for 7 days.`,
			confirmLabel: draft.keepTakeaway ? 'Keep takeaway and clear' : 'Clear desk',
			danger: true,
			action: async () => {
				await commitFinishNow(draft);
			}
		});
		return { ok: true, message: 'Review the clear confirmation.' };
	}

	async function activateSession(id: string) {
		await deps.prepareSessionSwitch();
		await deps.switchTo(id);
		await deps.loadNotes();
		await deps.loadContextCanvas(deps.getCanvasKey());
		deps.setSessionPanelOpen(false);
		const active = deps.getActiveSession();
		if (active) {
			deps.flashToast(
				`Opened ${active.title}. ${sessionLifecycleLabel(active, Date.now())}`
			);
		}
	}

	async function createScratchSession() {
		await deps.prepareSessionSwitch();
		const created = await deps.createScratch();
		await deps.loadNotes();
		await deps.loadContextCanvas(deps.getCanvasKey(), created.id);
		deps.setSessionPanelOpen(false);
		deps.flashToast('New scratch desk — clears after inactivity');
	}

	async function restoreSession(id: string) {
		await deps.prepareSessionSwitch();
		const restored = await deps.restore(id);
		if (!restored) return;
		await deps.loadNotes();
		await deps.loadContextCanvas(deps.getCanvasKey(), restored.id);
		deps.setSessionPanelOpen(false);
		deps.flashToast('Scratch desk restored');
	}

	function buildFinishSnapshot(view: 'desks' | 'finish') {
		const session = deps.getActiveSession();
		if (view === 'finish' && session) {
			return createFinishSnapshot({
				sessionId: session.id,
				canvasId: null,
				notes: deps.getNotes(),
				canvasItems: deps.getCanvasItems(),
				selectedNoteIds: deps.getSelectionIds(),
				operations: deps.getOperations()
			});
		}
		return null;
	}

	return {
		runFinishExport,
		commitFinishNow,
		runFinishCommit,
		activateSession,
		createScratchSession,
		restoreSession,
		buildFinishSnapshot
	};
}

export type FinishSessionUi = ReturnType<typeof createFinishSessionUi>;

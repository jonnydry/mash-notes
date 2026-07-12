import {
	KEPT_COLLECTION_SESSION_ID,
	LEGACY_SESSION_ID,
	createSessionRecord,
	db,
	deleteSessionPermanently,
	listSessionRecords,
	promoteNotesToKept
} from '$lib/db';
import {
	DEFAULT_SCRATCH_RETENTION_DAYS,
	SCRATCH_RETENTION_OPTIONS,
	expireScratchSession,
	scratchExpiry,
	shouldPermanentlyDeleteSession,
	withMeaningfulActivity
} from '$lib/session-lifecycle';
import type { Session } from '$lib/types';

export const ACTIVE_SESSION_STORAGE_KEY = 'mash.activeSessionId';
export const RETENTION_STORAGE_KEY = 'mash.scratchRetentionDays';

function readRetentionDays(): number {
	if (typeof localStorage === 'undefined') return DEFAULT_SCRATCH_RETENTION_DAYS;
	const value = Number(localStorage.getItem(RETENTION_STORAGE_KEY));
	return SCRATCH_RETENTION_OPTIONS.includes(value as (typeof SCRATCH_RETENTION_OPTIONS)[number])
		? value
		: DEFAULT_SCRATCH_RETENTION_DAYS;
}

function readActiveSessionId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
}

function writeActiveSessionId(id: string) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, id);
}

function writeRetentionDays(days: number) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(RETENTION_STORAGE_KEY, String(days));
}

export function createSessionManager() {
	let sessions = $state<Session[]>([]);
	let activeSessionId = $state<string | null>(readActiveSessionId());
	let retentionDays = $state(readRetentionDays());
	let ready = $state(false);
	let lastActivityWrite = 0;

	const activeSession = $derived(
		sessions.find((session) => session.id === activeSessionId && session.status === 'active') ??
			null
	);
	const activeSessions = $derived(sessions.filter((session) => session.status === 'active'));
	const recoveringSessions = $derived(
		sessions.filter((session) => session.status === 'recovering')
	);

	function replaceSession(next: Session) {
		sessions = sessions.map((session) => (session.id === next.id ? next : session));
	}

	async function createScratch(now = Date.now()): Promise<Session> {
		const scratchNumber = sessions.filter((session) => session.mode === 'scratch').length + 1;
		const created = await createSessionRecord({
			mode: 'scratch',
			title: scratchNumber === 1 ? 'Scratch desk' : `Scratch desk ${scratchNumber}`,
			now,
			expiresAt: scratchExpiry(now, retentionDays)
		});
		sessions = [created, ...sessions];
		activeSessionId = created.id;
		writeActiveSessionId(created.id);
		return created;
	}

	async function ensureLegacyFallback(now: number): Promise<Session | null> {
		const [noteCount, canvasCount] = await Promise.all([db.notes.count(), db.canvases.count()]);
		if (noteCount === 0 && canvasCount === 0) return null;
		const legacy: Session = {
			id: LEGACY_SESSION_ID,
			title: 'My existing MASH desk',
			mode: 'kept',
			status: 'active',
			created: now,
			modified: now,
			lastMeaningfulActivityAt: now
		};
		await db.transaction('rw', db.sessions, db.notes, db.canvases, async () => {
			await db.sessions.put(legacy);
			const notes = await db.notes.toArray();
			for (const note of notes) {
				await db.notes.update(note.id, {
					sessionId: legacy.id,
					scope: 'kept',
					keptAt: note.modified || now
				});
			}
			const canvases = await db.canvases.toArray();
			for (const canvas of canvases) {
				await db.canvases.update(canvas.id, { sessionId: legacy.id });
			}
		});
		return legacy;
	}

	async function reconcileActivity(session: Session): Promise<Session> {
		if (session.mode !== 'scratch' || session.status !== 'active') return session;
		const [notes, canvases] = await Promise.all([
			db.notes.where('sessionId').equals(session.id).toArray(),
			db.canvases.where('sessionId').equals(session.id).toArray()
		]);
		const latest = Math.max(
			session.lastMeaningfulActivityAt,
			...notes.map((note) => note.modified),
			...canvases.map((canvas) => canvas.modified)
		);
		if (latest <= session.lastMeaningfulActivityAt) return session;
		const updated = withMeaningfulActivity(session, latest, retentionDays);
		await db.sessions.put(updated);
		return updated;
	}

	async function bootstrap(now = Date.now()) {
		let loaded = await listSessionRecords();
		if (loaded.length === 0) {
			const legacy = await ensureLegacyFallback(now);
			loaded = legacy ? [legacy] : [];
		}

		const next: Session[] = [];
		for (const original of loaded) {
			const reconciled = await reconcileActivity(original);
			if (shouldPermanentlyDeleteSession(reconciled, now)) {
				await deleteSessionPermanently(reconciled.id, { preserveKeptNotes: true });
				continue;
			}
			const expired = expireScratchSession(reconciled, now);
			if (expired !== reconciled) await db.sessions.put(expired);
			next.push(expired);
		}
		sessions = next.sort((a, b) => b.modified - a.modified);

		if (sessions.length === 0 || sessions.every((session) => session.status !== 'active')) {
			await createScratch(now);
		} else {
			const preferred = sessions.find(
				(session) => session.id === activeSessionId && session.status === 'active'
			);
			activeSessionId =
				preferred?.id ?? sessions.find((session) => session.status === 'active')!.id;
			writeActiveSessionId(activeSessionId);
		}
		ready = true;
	}

	async function switchTo(id: string) {
		const session = sessions.find((candidate) => candidate.id === id);
		if (!session || session.status !== 'active') return;
		activeSessionId = id;
		writeActiveSessionId(id);
	}

	async function recordMeaningfulActivity(now = Date.now()) {
		const session = activeSession;
		if (!session) return;
		const updated = withMeaningfulActivity(session, now, retentionDays);
		replaceSession(updated);
		if (now - lastActivityWrite < 30_000) return;
		lastActivityWrite = now;
		await db.sessions.put(updated);
	}

	async function keepActive(now = Date.now()) {
		const session = activeSession;
		if (!session || session.mode === 'kept') return session;
		const kept: Session = {
			...session,
			mode: 'kept',
			status: 'active',
			modified: now,
			lastMeaningfulActivityAt: now,
			expiresAt: undefined,
			recoveryUntil: undefined
		};
		await db.transaction('rw', db.sessions, db.notes, async () => {
			await db.sessions.put(kept);
			const notes = await db.notes.where('sessionId').equals(session.id).toArray();
			for (const note of notes) {
				// Soft-deleted rows stay tombstones — do not promote discarded trash to kept.
				if (note.deletedAt != null) continue;
				await db.notes.update(note.id, { scope: 'kept', keptAt: now });
			}
		});
		replaceSession(kept);
		return kept;
	}

	async function keepTakeaway(noteIds: string[], now = Date.now()) {
		const session = activeSession;
		if (!session) return [];
		const promoted = await promoteNotesToKept(session.id, noteIds, now);
		if (promoted.length === 0) return [];
		const collection = await db.sessions.get(KEPT_COLLECTION_SESSION_ID);
		if (collection && !sessions.some((candidate) => candidate.id === collection.id)) {
			sessions = [collection, ...sessions];
		} else if (collection) {
			replaceSession(collection);
		}
		return promoted;
	}

	async function clearActive(now = Date.now()) {
		const session = activeSession;
		if (!session) return null;
		const recovering: Session = {
			...session,
			mode: 'scratch',
			status: 'recovering',
			modified: now,
			expiresAt: now,
			recoveryUntil: now + 7 * 24 * 60 * 60 * 1000
		};
		await db.sessions.put(recovering);
		replaceSession(recovering);
		return createScratch(now);
	}

	async function restore(id: string, now = Date.now()) {
		const session = sessions.find((candidate) => candidate.id === id);
		if (!session || session.status !== 'recovering') return null;
		const restored: Session = {
			...session,
			mode: 'scratch',
			status: 'active',
			modified: now,
			lastMeaningfulActivityAt: now,
			expiresAt: scratchExpiry(now, retentionDays),
			recoveryUntil: undefined
		};
		await db.sessions.put(restored);
		replaceSession(restored);
		activeSessionId = restored.id;
		writeActiveSessionId(restored.id);
		return restored;
	}

	async function setRetentionDays(days: number, now = Date.now()) {
		if (!SCRATCH_RETENTION_OPTIONS.includes(days as (typeof SCRATCH_RETENTION_OPTIONS)[number])) {
			return;
		}
		retentionDays = days;
		writeRetentionDays(days);
		const updates: Session[] = [];
		for (const session of sessions) {
			if (session.mode !== 'scratch' || session.status !== 'active') continue;
			const updated = {
				...session,
				modified: now,
				expiresAt: scratchExpiry(session.lastMeaningfulActivityAt, days)
			};
			await db.sessions.put(updated);
			updates.push(updated);
		}
		sessions = sessions.map(
			(session) => updates.find((updated) => updated.id === session.id) ?? session
		);
	}

	/** Remove only scratch desks whose recovery deadline has passed. */
	async function purgePermanentlyExpired(now = Date.now()): Promise<number> {
		const expiredIds = sessions
			.filter((session) => shouldPermanentlyDeleteSession(session, now))
			.map((session) => session.id);
		for (const id of expiredIds) {
			await deleteSessionPermanently(id, { preserveKeptNotes: true });
		}
		if (expiredIds.length > 0) {
			sessions = sessions.filter((session) => !expiredIds.includes(session.id));
		}
		return expiredIds.length;
	}

	return {
		get sessions() {
			return sessions;
		},
		get activeSession() {
			return activeSession;
		},
		get activeSessions() {
			return activeSessions;
		},
		get recoveringSessions() {
			return recoveringSessions;
		},
		get retentionDays() {
			return retentionDays;
		},
		get ready() {
			return ready;
		},
		bootstrap,
		createScratch,
		switchTo,
		recordMeaningfulActivity,
		keepActive,
		keepTakeaway,
		clearActive,
		restore,
		setRetentionDays,
		purgePermanentlyExpired,
		shouldSeedWelcome: () => sessions.length === 1 && activeSession?.mode === 'scratch'
	};
}

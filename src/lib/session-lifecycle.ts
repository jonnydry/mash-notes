import type { Session } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SCRATCH_RETENTION_DAYS = 14;
export const RECOVERY_DAYS = 7;
export const SCRATCH_RETENTION_OPTIONS = [1, 7, 14, 30] as const;

export function scratchExpiry(now: number, retentionDays = DEFAULT_SCRATCH_RETENTION_DAYS) {
	return now + retentionDays * DAY_MS;
}

export function recoveryDeadline(now: number) {
	return now + RECOVERY_DAYS * DAY_MS;
}

export function daysRemaining(deadline: number | undefined, now: number): number | null {
	if (deadline === undefined) return null;
	return Math.max(0, Math.ceil((deadline - now) / DAY_MS));
}

export function sessionLifecycleLabel(session: Session, now: number): string {
	if (session.mode === 'kept') return 'Kept on this device';
	if (session.status === 'recovering') {
		const days = daysRemaining(session.recoveryUntil, now) ?? 0;
		return days === 0 ? 'Clears today' : `Recoverable for ${days} day${days === 1 ? '' : 's'}`;
	}
	const days = daysRemaining(session.expiresAt, now) ?? DEFAULT_SCRATCH_RETENTION_DAYS;
	return days === 0 ? 'Clears today' : `Scratch · clears in ${days} day${days === 1 ? '' : 's'}`;
}

export function withMeaningfulActivity(
	session: Session,
	now: number,
	retentionDays = DEFAULT_SCRATCH_RETENTION_DAYS
): Session {
	if (session.mode === 'kept') {
		return { ...session, modified: now, lastMeaningfulActivityAt: now };
	}
	return {
		...session,
		status: 'active',
		modified: now,
		lastMeaningfulActivityAt: now,
		expiresAt: scratchExpiry(now, retentionDays),
		recoveryUntil: undefined
	};
}

export function expireScratchSession(session: Session, now: number): Session {
	if (session.mode !== 'scratch' || session.status !== 'active') return session;
	if (session.expiresAt === undefined || session.expiresAt > now) return session;
	return {
		...session,
		status: 'recovering',
		modified: now,
		recoveryUntil: recoveryDeadline(now)
	};
}

export function shouldPermanentlyDeleteSession(session: Session, now: number): boolean {
	return (
		session.mode === 'scratch' &&
		session.status === 'recovering' &&
		session.recoveryUntil !== undefined &&
		session.recoveryUntil <= now
	);
}

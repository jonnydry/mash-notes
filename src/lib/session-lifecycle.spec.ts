import { describe, expect, it } from 'vitest';
import type { Session } from './types';
import {
	DAY_MS,
	expireScratchSession,
	scratchExpiry,
	sessionLifecycleLabel,
	shouldPermanentlyDeleteSession,
	withMeaningfulActivity
} from './session-lifecycle';

function session(patch: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		title: 'Scratch desk',
		mode: 'scratch',
		status: 'active',
		created: 0,
		modified: 0,
		lastMeaningfulActivityAt: 0,
		expiresAt: 14 * DAY_MS,
		...patch
	};
}

describe('session lifecycle', () => {
	it('extends a scratch desk only from meaningful activity', () => {
		const updated = withMeaningfulActivity(session(), 3 * DAY_MS, 7);
		expect(updated.lastMeaningfulActivityAt).toBe(3 * DAY_MS);
		expect(updated.expiresAt).toBe(10 * DAY_MS);
	});

	it('moves an expired scratch desk into recovery', () => {
		const expired = expireScratchSession(session({ expiresAt: DAY_MS }), 2 * DAY_MS);
		expect(expired.status).toBe('recovering');
		expect(expired.recoveryUntil).toBe(9 * DAY_MS);
	});

	it('never expires a kept desk', () => {
		const kept = expireScratchSession(session({ mode: 'kept', expiresAt: undefined }), 99 * DAY_MS);
		expect(kept.status).toBe('active');
		expect(shouldPermanentlyDeleteSession(kept, 100 * DAY_MS)).toBe(false);
	});

	it('permanently deletes only after recovery ends', () => {
		const recovering = session({ status: 'recovering', recoveryUntil: 5 * DAY_MS });
		expect(shouldPermanentlyDeleteSession(recovering, 4 * DAY_MS)).toBe(false);
		expect(shouldPermanentlyDeleteSession(recovering, 5 * DAY_MS)).toBe(true);
	});

	it('uses calm lifecycle labels', () => {
		expect(sessionLifecycleLabel(session({ expiresAt: scratchExpiry(0, 14) }), 0)).toBe(
			'Scratch · clears in 14 days'
		);
		expect(sessionLifecycleLabel(session({ mode: 'kept', expiresAt: undefined }), 0)).toBe(
			'Kept on this device'
		);
	});
});

import { describe, expect, it } from 'vitest';
import { actionsForSurface, createActionRegistry } from './action-registry';

describe('action registry', () => {
	it('normalizes defaults and filters by surface and availability', () => {
		const actions = createActionRegistry([
			{ label: 'Always available', action: () => undefined },
			{
				id: 'selection-only',
				label: 'Selection only',
				action: () => undefined,
				surfaces: ['selection'],
				available: () => false
			}
		]);
		expect(actions[0]).toMatchObject({
			id: 'always-available',
			mutation: 'none',
			undo: 'none'
		});
		expect(actionsForSurface(actions, 'palette').map((action) => action.id)).toEqual([
			'always-available'
		]);
		expect(actionsForSurface(actions, 'selection')).toEqual([]);
	});

	it('rejects duplicate action ids', () => {
		expect(() =>
			createActionRegistry([
				{ label: 'Same action', action: () => undefined },
				{ label: 'Same action', action: () => undefined }
			])
		).toThrow(/Duplicate/);
	});

	it('throws when a punctuation-only label slugs to an empty id', () => {
		expect(() => createActionRegistry([{ label: '!!!', action: () => undefined }])).toThrow(
			/Duplicate or empty/
		);
	});

	it('throws when an explicit id is empty even with a normal label', () => {
		expect(() =>
			createActionRegistry([{ id: '', label: 'Hello', action: () => undefined }])
		).toThrow(/empty/i);
	});

	it('uses an explicit id over the derived slug', () => {
		const actions = createActionRegistry([
			{ id: 'custom-id', label: 'Hello World', action: () => undefined }
		]);
		expect(actions[0].id).toBe('custom-id');
	});

	it('lists a selection-only action when it is available', () => {
		const actions = createActionRegistry([
			{
				label: 'Pick me',
				surfaces: ['selection'],
				available: () => true,
				action: () => undefined
			}
		]);
		expect(actionsForSurface(actions, 'selection').map((action) => action.id)).toEqual(['pick-me']);
	});
});

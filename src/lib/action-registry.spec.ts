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
});

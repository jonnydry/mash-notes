import { describe, it, expect, beforeEach } from 'vitest';
import { syncConflicts } from './sync-conflicts.svelte';
import type { SyncConflict } from '$lib/sync-model';

describe('syncConflicts session', () => {
	beforeEach(() => {
		syncConflicts.clear();
	});

	it('queues all conflicts and resolves one at a time', () => {
		const conflicts: SyncConflict[] = [
			{
				noteId: 'a',
				field: 'body',
				local: 'local body',
				remote: 'remote body',
				chosen: 'remote'
			},
			{
				noteId: 'a',
				field: 'title',
				local: 'L',
				remote: 'R',
				chosen: 'remote'
			},
			{
				noteId: 'b',
				field: 'body',
				local: 'b1',
				remote: 'b2',
				chosen: 'local'
			}
		];
		syncConflicts.setFromImport(conflicts);
		expect(syncConflicts.count).toBe(3);
		expect(syncConflicts.bodyCount).toBe(2);

		syncConflicts.dismiss('a:title');
		expect(syncConflicts.count).toBe(2);
		expect(syncConflicts.items.map((c) => c.id)).toEqual(['a:body', 'b:body']);

		syncConflicts.dismissNote('a');
		expect(syncConflicts.count).toBe(1);
		expect(syncConflicts.items[0].id).toBe('b:body');
	});

	it('keeps full snapshots for all fields', () => {
		const long = 'x'.repeat(200);
		syncConflicts.setFromImport([
			{
				noteId: 'n',
				field: 'body',
				local: long,
				remote: 'r',
				chosen: 'remote'
			},
			{
				noteId: 'n',
				field: 'title',
				local: long,
				remote: 'short',
				chosen: 'local'
			}
		]);
		expect(syncConflicts.get('n:body')?.local).toBe(long);
		expect(syncConflicts.get('n:title')?.local).toBe(long);
	});
});

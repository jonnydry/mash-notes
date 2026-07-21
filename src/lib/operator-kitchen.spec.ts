import { describe, expect, it } from 'vitest';
import {
	formatContentOperatorToast,
	formatLayoutOperatorToast,
	kitchenActionSubtitle,
	kitchenActionTitle,
	kitchenGroupForActionId,
	latestActiveOperation,
	operationReceiptView,
	operationTypeLabel
} from './operator-kitchen';
import type { Operation } from './types';

function op(partial: Partial<Operation> & Pick<Operation, 'id' | 'type'>): Operation {
	return {
		id: partial.id,
		sessionId: partial.sessionId ?? 's1',
		type: partial.type,
		inputNoteIds: partial.inputNoteIds ?? ['a'],
		outputNoteIds: partial.outputNoteIds ?? ['b'],
		created: partial.created ?? 1,
		revertedAt: partial.revertedAt
	};
}

describe('operator-kitchen', () => {
	it('groups action ids into kitchen sections', () => {
		expect(kitchenGroupForActionId('split-selection-lines')).toBe('shape');
		expect(kitchenGroupForActionId('stack-selection')).toBe('arrange');
		expect(kitchenGroupForActionId('keep-selection')).toBe(null);
		expect(kitchenGroupForActionId('export-selection-pdf')).toBe(null);
	});

	it('shortens titles and writes plain subtitles', () => {
		expect(kitchenActionTitle('stack-selection', 'Stack selected cards')).toBe('Stack');
		expect(kitchenActionTitle('sequence-selection', 'Sequence selected cards')).toBe(
			'Sequence selected'
		);
		expect(kitchenActionSubtitle('sequence-selection')).toBe(
			'Orders cards top-to-bottom, then left-to-right'
		);
		expect(kitchenActionSubtitle('deduplicate-selection')).toMatch(/notes stay/i);
		expect(kitchenActionSubtitle('combine-selection')).toMatch(/Undo or Unmash/i);
		expect(kitchenActionSubtitle('shuffle-selection')).toMatch(/layout/i);
	});

	it('labels operations and builds receipt views', () => {
		expect(operationTypeLabel('mash')).toBe('Mash');
		expect(operationTypeLabel('split-lines')).toBe('Split by lines');
		const view = operationReceiptView(
			op({
				id: '1',
				type: 'mash',
				inputNoteIds: ['a', 'b', 'c'],
				outputNoteIds: ['z']
			})
		);
		expect(view.title).toBe('Mash');
		expect(view.summary).toBe('3 → 1');
		expect(view.detail).toMatch(/Combined 3/);
	});

	it('picks the latest non-reverted operation', () => {
		const ops = [
			op({ id: 'new-reverted', type: 'mash', created: 3, revertedAt: 9 }),
			op({ id: 'active', type: 'split-lines', created: 2 }),
			op({ id: 'older', type: 'mash', created: 1 })
		];
		// list is newest-first as listOperationRecords returns
		expect(latestActiveOperation(ops)?.id).toBe('active');
		expect(latestActiveOperation([ops[0]!])).toBe(null);
	});

	it('formats operator toasts', () => {
		expect(formatLayoutOperatorToast('Stack')).toMatch(/Undo restores/);
		expect(formatContentOperatorToast('Mash', 3, 1)).toBe('Mash · 3 → 1 · Undoable');
	});
});

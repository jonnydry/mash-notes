/**
 * Operator kitchen — labels, groups, and receipt copy for set operations.
 * Durable Operation rows (mash/split) power visible receipts; layout ops stay toast+undo.
 */
import type { Operation } from './types';

export type KitchenGroupId = 'shape' | 'arrange';

export type KitchenGroup = {
	id: KitchenGroupId;
	label: string;
	hint: string;
};

export const KITCHEN_GROUPS: KitchenGroup[] = [
	{
		id: 'shape',
		label: 'Shape',
		hint: 'Change what the cards contain'
	},
	{
		id: 'arrange',
		label: 'Arrange',
		hint: 'Move the set without rewriting notes'
	}
];

/** Map action registry ids → kitchen group (Transform menu). */
export function kitchenGroupForActionId(actionId: string): KitchenGroupId | null {
	if (
		actionId === 'combine-selection' ||
		actionId === 'unmash-selection' ||
		actionId.startsWith('split-selection-') ||
		actionId === 'deduplicate-selection'
	) {
		return 'shape';
	}
	if (
		actionId === 'stack-selection' ||
		actionId === 'spread-selection' ||
		actionId === 'sequence-selection' ||
		actionId.startsWith('sort-selection-') ||
		actionId === 'shuffle-selection'
	) {
		return 'arrange';
	}
	return null;
}

/** Short label for Transform buttons (strip “selected …” noise). */
export function kitchenActionTitle(actionId: string, fullLabel: string): string {
	const map: Record<string, string> = {
		'combine-selection': 'Mash into one',
		'unmash-selection': 'Unmash result',
		'split-selection-headings': 'Split by headings',
		'split-selection-paragraphs': 'Split by paragraphs',
		'split-selection-lines': 'Split by lines',
		'stack-selection': 'Stack',
		'spread-selection': 'Spread',
		'sequence-selection': 'Sequence selected',
		'sort-selection-title': 'Sort by title',
		'sort-selection-created': 'Sort by created',
		'shuffle-selection': 'Shuffle',
		'deduplicate-selection': 'Deduplicate'
	};
	if (map[actionId]) return map[actionId];
	const shortened = fullLabel.replace(/\s+selected.*$/i, '').trim();
	return shortened || fullLabel;
}

export function kitchenActionSubtitle(actionId: string): string {
	if (actionId.startsWith('split-selection-')) {
		return 'Creates traced fragments · undoable';
	}
	if (actionId === 'combine-selection') {
		return 'Combine into one sticky · Undo or Unmash restores';
	}
	if (actionId === 'unmash-selection') {
		return 'Restore mashed sources · Undoable';
	}
	if (actionId === 'deduplicate-selection') {
		return 'Removes duplicate cards · notes stay in library';
	}
	if (actionId === 'sequence-selection') {
		return 'Orders cards top-to-bottom, then left-to-right';
	}
	if (
		actionId === 'stack-selection' ||
		actionId === 'spread-selection' ||
		actionId.startsWith('sort-selection-') ||
		actionId === 'shuffle-selection'
	) {
		return 'Undoable layout · notes unchanged';
	}
	return 'Transform selection';
}

/** Human label for durable Operation.type values. */
export function operationTypeLabel(type: string): string {
	const map: Record<string, string> = {
		mash: 'Mash',
		'split-headings': 'Split by headings',
		'split-paragraphs': 'Split by paragraphs',
		'split-lines': 'Split by lines',
		deduplicate: 'Deduplicate'
	};
	if (map[type]) return map[type];
	if (type.startsWith('split-')) return 'Split';
	return type
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export type OperationReceiptView = {
	id: string;
	title: string;
	summary: string;
	detail: string;
	created: number;
	reverted: boolean;
	inputCount: number;
	outputCount: number;
};

export function operationReceiptView(op: Operation): OperationReceiptView {
	const inputCount = op.inputNoteIds.length;
	const outputCount = op.outputNoteIds.length;
	const title = operationTypeLabel(op.type);
	const summary =
		inputCount === outputCount && inputCount > 0
			? `${inputCount} card${inputCount === 1 ? '' : 's'}`
			: `${inputCount} → ${outputCount}`;
	const detail = op.revertedAt
		? 'Reverted'
		: outputCount === 1 && inputCount > 1
			? `Combined ${inputCount} into 1 result`
			: inputCount === 1 && outputCount > 1
				? `Split into ${outputCount} cards`
				: `${inputCount} in · ${outputCount} out`;
	return {
		id: op.id,
		title,
		summary,
		detail,
		created: op.created,
		reverted: Boolean(op.revertedAt),
		inputCount,
		outputCount
	};
}

/** Newest non-reverted durable receipt for the kitchen strip. */
export function latestActiveOperation(operations: readonly Operation[]): Operation | null {
	for (const op of operations) {
		if (op.revertedAt == null) return op;
	}
	return null;
}

export function formatLayoutOperatorToast(label: string): string {
	return `${label} — Undo restores the prior arrangement`;
}

export function formatContentOperatorToast(
	title: string,
	inputCount: number,
	outputCount: number
): string {
	if (inputCount === outputCount) {
		return `${title} · ${inputCount} card${inputCount === 1 ? '' : 's'} · Undoable`;
	}
	return `${title} · ${inputCount} → ${outputCount} · Undoable`;
}

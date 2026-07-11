export type ActionMutation = 'none' | 'content' | 'layout' | 'session';
export type ActionSurface = 'palette' | 'selection' | 'shortcut' | 'context';

export type MashActionDefinition = {
	id: string;
	label: string;
	shortcut: string;
	mutation: ActionMutation;
	surfaces: ActionSurface[];
	available?: () => boolean;
	confirmation?: 'none' | 'required';
	undo?: 'none' | 'layout' | 'content';
	action: () => void | Promise<void>;
};

export type MashActionInput = Omit<Partial<MashActionDefinition>, 'label' | 'action'> &
	Pick<MashActionDefinition, 'label' | 'action'>;

function actionId(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function createActionRegistry(actions: MashActionInput[]): MashActionDefinition[] {
	const ids = new Set<string>();
	return actions.map((action) => {
		const id = action.id ?? actionId(action.label);
		if (!id || ids.has(id)) throw new Error(`Duplicate or empty action id: ${id}`);
		ids.add(id);
		return {
			id,
			label: action.label,
			shortcut: action.shortcut ?? '',
			mutation: action.mutation ?? 'none',
			surfaces: action.surfaces ?? ['palette'],
			available: action.available,
			confirmation: action.confirmation ?? 'none',
			undo: action.undo ?? 'none',
			action: action.action
		};
	});
}

export function actionsForSurface(
	actions: MashActionDefinition[],
	surface: ActionSurface
): MashActionDefinition[] {
	return actions.filter(
		(action) => action.surfaces.includes(surface) && (action.available?.() ?? true)
	);
}

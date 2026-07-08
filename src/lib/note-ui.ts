export type NavFilter = { type: 'folder' | 'tag' | 'pinned' | null; value?: string };
export type NavKind = 'all' | 'pinned' | 'folder' | 'tag';

export function isNavActive(
	filter: NavFilter,
	kind: NavKind,
	value?: string,
	_searchQuery = ''
): boolean {
	switch (kind) {
		case 'all':
			return filter.type === null;
		case 'pinned':
			return filter.type === 'pinned';
		case 'folder':
			return filter.type === 'folder' && filter.value === (value ?? '');
		case 'tag':
			return filter.type === 'tag' && filter.value === value;
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}

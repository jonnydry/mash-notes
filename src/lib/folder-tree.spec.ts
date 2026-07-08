import { describe, it, expect } from 'vitest';
import { buildFolderTree, flattenFolderTree } from './folder-tree';

describe('folder-tree', () => {
	it('nests path segments', () => {
		const tree = buildFolderTree(['Ideas', 'Ideas/Work', 'Personal']);
		expect(tree.map((n) => n.name)).toEqual(['Ideas', 'Personal']);
		expect(tree[0].children.map((c) => c.path)).toEqual(['Ideas/Work']);
	});

	it('flattens with depth', () => {
		const flat = flattenFolderTree(buildFolderTree(['A/B/C']));
		expect(flat.map((f) => [f.node.path, f.depth])).toEqual([
			['A', 0],
			['A/B', 1],
			['A/B/C', 2]
		]);
	});
});

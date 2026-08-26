import { describe, it, expect } from 'vitest';
import { buildFolderTree, flattenFolderTree } from './folder-tree';

describe('folder-tree', () => {
	it('nests path segments', () => {
		const tree = buildFolderTree(['Ideas', 'Ideas/Work', 'Personal']);
		expect(tree.map((n) => n.name)).toEqual(['Ideas', 'Personal']);
		expect(tree[0].children.map((c) => c.path)).toEqual(['Ideas/Work']);
	});

	it('flattens with depth (depth-first)', () => {
		const flat = flattenFolderTree(buildFolderTree(['A/B/C']));
		expect(flat.map((f) => [f.node.path, f.depth])).toEqual([
			['A', 0],
			['A/B', 1],
			['A/B/C', 2]
		]);
	});

	it('drops empty and falsy entries', () => {
		const tree = buildFolderTree(['', 'Notes', '']);
		expect(tree).toEqual([{ name: 'Notes', path: 'Notes', children: [] }]);
	});

	it('collapses duplicate paths to a single node', () => {
		const tree = buildFolderTree(['Work', 'Work', 'Work/A']);
		expect(tree.map((n) => n.name)).toEqual(['Work']);
		expect(tree[0].children.map((c) => c.path)).toEqual(['Work/A']);
	});

	it('treats leading and trailing slashes as no-op segments', () => {
		const withSlashes = buildFolderTree(['/Ideas/Work/', 'Ideas']);
		const without = buildFolderTree(['Ideas', 'Ideas/Work']);
		expect(withSlashes).toEqual(without);
	});

	it('sorts roots alphabetically', () => {
		expect(buildFolderTree(['Zebra', 'Apple']).map((n) => n.name)).toEqual(['Apple', 'Zebra']);
	});

	it('flattens an empty tree to nothing', () => {
		expect(flattenFolderTree([]).map((f) => [f.node.path, f.depth])).toEqual([]);
	});
});

/**
 * Build a folder tree from path strings like "Ideas/Work".
 */
export type FolderNode = {
	name: string;
	path: string;
	children: FolderNode[];
};

export function buildFolderTree(folders: string[]): FolderNode[] {
	const root: FolderNode[] = [];
	const byPath = new Map<string, FolderNode>();

	const sorted = [...new Set(folders.filter(Boolean))].sort();
	for (const full of sorted) {
		const parts = full.split('/').filter(Boolean);
		let parentPath = '';
		let siblings = root;
		for (const part of parts) {
			const path = parentPath ? `${parentPath}/${part}` : part;
			let node = byPath.get(path);
			if (!node) {
				node = { name: part, path, children: [] };
				byPath.set(path, node);
				siblings.push(node);
			}
			siblings = node.children;
			parentPath = path;
		}
	}
	return root;
}

/** Flatten tree depth-first for rendering with indent level. */
export function flattenFolderTree(
	nodes: FolderNode[],
	depth = 0
): Array<{ node: FolderNode; depth: number }> {
	const out: Array<{ node: FolderNode; depth: number }> = [];
	for (const node of nodes) {
		out.push({ node, depth });
		out.push(...flattenFolderTree(node.children, depth + 1));
	}
	return out;
}

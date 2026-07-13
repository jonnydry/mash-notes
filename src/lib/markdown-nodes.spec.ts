import { describe, expect, it } from 'vitest';
import { markdownNodes, type MarkdownNode } from './markdown-nodes';

function flatten(nodes: MarkdownNode[]): MarkdownNode[] {
	return nodes.flatMap((node) => {
		switch (node.type) {
			case 'paragraph':
			case 'heading':
			case 'strong':
			case 'emphasis':
			case 'delete':
			case 'link':
			case 'blockquote':
				return [node, ...flatten(node.children)];
			case 'list':
				return [node, ...node.items.flatMap((item) => flatten(item.children))];
			case 'table':
				return [
					node,
					...node.header.flatMap(flatten),
					...node.rows.flatMap((row) => row.flatMap(flatten))
				];
			default:
				return [node];
		}
	});
}

describe('markdown-nodes', () => {
	it('builds structural preview nodes for headings, emphasis, and wikilinks', () => {
		const nodes = flatten(markdownNodes('# Guide\n\nUse **Mash** with [[Project ideas|ideas]].'));
		expect(nodes).toContainEqual(expect.objectContaining({ type: 'heading', depth: 1 }));
		expect(nodes).toContainEqual(expect.objectContaining({ type: 'strong' }));
		expect(nodes).toContainEqual({
			type: 'wikilink',
			target: 'Project ideas',
			label: 'ideas'
		});
	});

	it('keeps raw HTML inert and blocks active link and image schemes', () => {
		const nodes = flatten(
			markdownNodes(
				'<script>alert(1)</script>\n\n[x](javascript:alert(1)) ![x](https://x.test/x.png)'
			)
		);
		expect(nodes).toContainEqual({ type: 'text', text: '<script>alert(1)</script>' });
		expect(nodes).toContainEqual(expect.objectContaining({ type: 'link', href: '#' }));
		expect(nodes.some((node) => node.type === 'image')).toBe(false);
	});

	it('preserves lists, task state, code, and tables without HTML strings', () => {
		const nodes = flatten(
			markdownNodes('- [x] done\n- [ ] next\n\n`code`\n\n| A | B |\n| - | - |\n| 1 | 2 |')
		);
		const list = nodes.find((node) => node.type === 'list');
		expect(list).toMatchObject({
			type: 'list',
			items: [
				{ task: true, checked: true },
				{ task: true, checked: false }
			]
		});
		expect(nodes).toContainEqual({ type: 'code', text: 'code' });
		expect(nodes).toContainEqual(expect.objectContaining({ type: 'table' }));
	});
});

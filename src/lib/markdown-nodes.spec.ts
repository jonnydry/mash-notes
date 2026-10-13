import { beforeAll, describe, expect, it } from 'vitest';
import {
	markdownNodes,
	plainMarkdownNodes,
	preloadMarked,
	runAfterFirstPaint,
	selectPreviewNodes,
	type MarkdownNode
} from './markdown-nodes';

beforeAll(async () => {
	await preloadMarked();
});

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

function visibleText(nodes: MarkdownNode[]): string {
	return nodes
		.map((node) => {
			switch (node.type) {
				case 'text':
				case 'code':
				case 'code-block':
					return node.text;
				case 'wikilink':
					return node.label;
				case 'paragraph':
				case 'heading':
				case 'strong':
				case 'emphasis':
				case 'delete':
				case 'link':
				case 'blockquote':
					return visibleText(node.children);
				case 'list':
					return node.items.map((item) => visibleText(item.children)).join('');
				case 'table':
					return [...node.header, ...node.rows.flat()].map(visibleText).join('');
				default:
					return '';
			}
		})
		.join('');
}

describe('preview while marked loads', () => {
	it('strips emphasis markers before markdown is ready', () => {
		const nodes = plainMarkdownNodes('Use **Mash**');
		expect(nodes).toEqual([
			{
				type: 'paragraph',
				children: [
					{ type: 'text', text: 'Use ' },
					{ type: 'strong', children: [{ type: 'text', text: 'Mash' }] }
				]
			}
		]);
		expect(selectPreviewNodes('Use **Mash**', null, null)).toEqual(nodes);
		expect(visibleText(nodes)).toBe('Use Mash');
		expect(plainMarkdownNodes('a *b* and _c_ and `d`')).toEqual([
			{
				type: 'paragraph',
				children: [
					{ type: 'text', text: 'a ' },
					{ type: 'emphasis', children: [{ type: 'text', text: 'b' }] },
					{ type: 'text', text: ' and ' },
					{ type: 'emphasis', children: [{ type: 'text', text: 'c' }] },
					{ type: 'text', text: ' and ' },
					{ type: 'code', text: 'd' }
				]
			}
		]);
		expect(plainMarkdownNodes('one\ntwo')).toEqual([
			{
				type: 'paragraph',
				children: [{ type: 'text', text: 'one' }, { type: 'break' }, { type: 'text', text: 'two' }]
			}
		]);
	});

	it('keeps heading, link, and list structure without the markers', () => {
		expect(plainMarkdownNodes('# Guide')).toEqual([
			{ type: 'heading', depth: 1, children: [{ type: 'text', text: 'Guide' }] }
		]);
		expect(plainMarkdownNodes('## Section')).toEqual([
			{ type: 'heading', depth: 2, children: [{ type: 'text', text: 'Section' }] }
		]);
		expect(plainMarkdownNodes('See [Docs](https://example.com).')).toEqual([
			{
				type: 'paragraph',
				children: [
					{ type: 'text', text: 'See ' },
					{
						type: 'link',
						href: 'https://example.com',
						children: [{ type: 'text', text: 'Docs' }]
					},
					{ type: 'text', text: '.' }
				]
			}
		]);
		expect(plainMarkdownNodes('- alpha\n- beta')).toEqual([
			{
				type: 'list',
				ordered: false,
				items: [
					{ children: [{ type: 'text', text: 'alpha' }], task: false, checked: false },
					{ children: [{ type: 'text', text: 'beta' }], task: false, checked: false }
				]
			}
		]);
		expect(plainMarkdownNodes('> quoted\n\n---')).toEqual([
			{
				type: 'blockquote',
				children: [{ type: 'paragraph', children: [{ type: 'text', text: 'quoted' }] }]
			},
			{ type: 'rule' }
		]);
	});

	it('never shows raw markers on a cold-cache preview of a new card', () => {
		const source = [
			'# Welcome',
			'',
			'Use **Mash** and [Docs](https://example.com).',
			'',
			'- one',
			'- two'
		].join('\n');
		const nodes = selectPreviewNodes(source, null, null);
		const visible = visibleText(nodes);
		expect(nodes.length).toBeGreaterThan(0);
		expect(visible.length).toBeGreaterThan(0);
		expect(visible).not.toContain('#');
		expect(visible).not.toContain('**');
		expect(visible).toContain('Welcome');
		expect(visible).toContain('Mash');
		expect(visible).toContain('Docs');
		expect(visible).toContain('one');
		expect(nodes.some((node) => node.type === 'heading' && node.depth === 1)).toBe(true);
		expect(nodes.some((node) => node.type === 'list' && node.ordered === false)).toBe(true);
	});

	it('keeps the previous output until the next render is ready', () => {
		const previous: MarkdownNode[] = [
			{ type: 'paragraph', children: [{ type: 'text', text: 'kept' }] }
		];
		expect(selectPreviewNodes('**next**', previous, null)).toBe(previous);
	});

	it('uses ready markdown nodes when they are available', () => {
		const previous: MarkdownNode[] = [
			{ type: 'paragraph', children: [{ type: 'text', text: 'old' }] }
		];
		const ready: MarkdownNode[] = [
			{ type: 'paragraph', children: [{ type: 'text', text: 'ready' }] }
		];
		expect(selectPreviewNodes('x', previous, ready)).toBe(ready);
	});

	it('preloads on the frame after first paint and skips cancelled work', () => {
		const queued = new Map<number, FrameRequestCallback>();
		let nextId = 1;
		const originalFrame = globalThis.requestAnimationFrame;
		const originalCancel = globalThis.cancelAnimationFrame;
		globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			const id = nextId++;
			queued.set(id, callback);
			return id;
		}) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = ((id: number) => {
			queued.delete(id);
		}) as typeof cancelAnimationFrame;
		const flush = (id: number) => {
			const callback = queued.get(id);
			queued.delete(id);
			callback?.(0);
		};
		try {
			let ran = 0;
			const cancel = runAfterFirstPaint(() => {
				ran += 1;
			});
			expect(ran).toBe(0);
			expect(queued.size).toBe(1);
			flush(1);
			expect(ran).toBe(0);
			expect(queued.size).toBe(1);
			flush(2);
			expect(ran).toBe(1);

			ran = 0;
			const cancelled = runAfterFirstPaint(() => {
				ran += 1;
			});
			flush(3);
			cancelled();
			flush(4);
			expect(ran).toBe(0);
			cancel();
		} finally {
			globalThis.requestAnimationFrame = originalFrame;
			globalThis.cancelAnimationFrame = originalCancel;
		}
	});
});

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

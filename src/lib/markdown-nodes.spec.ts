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

describe('preview while marked loads', () => {
	it('renders plain text until markdown is ready', () => {
		expect(selectPreviewNodes('Use **Mash**', null, null)).toEqual(
			plainMarkdownNodes('Use **Mash**')
		);
		expect(plainMarkdownNodes('one\ntwo')).toEqual([
			{
				type: 'paragraph',
				children: [{ type: 'text', text: 'one' }, { type: 'break' }, { type: 'text', text: 'two' }]
			}
		]);
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

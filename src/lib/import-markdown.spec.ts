import { describe, it, expect } from 'vitest';
import {
	extractInlineTags,
	filesFromFileList,
	firstHeadingTitle,
	isMarkdownNotePath,
	markdownFileToNote,
	parseFrontmatter,
	parseMarkdownVault,
	pathToFolderAndTitle
} from './import-markdown';

describe('import-markdown', () => {
	it('maps vault-relative paths to folder + title', () => {
		expect(pathToFolderAndTitle('Vault/Ideas/Work/hello.md')).toEqual({
			folder: 'Ideas/Work',
			title: 'hello'
		});
		expect(pathToFolderAndTitle('solo.md')).toEqual({ folder: '', title: 'solo' });
	});

	it('skips obsidian metadata and non-md files', () => {
		expect(isMarkdownNotePath('Vault/.obsidian/app.json')).toBe(false);
		expect(isMarkdownNotePath('Vault/.trash/old.md')).toBe(false);
		expect(isMarkdownNotePath('Vault/note.txt')).toBe(false);
		expect(isMarkdownNotePath('Vault/Ideas/note.md')).toBe(true);
	});

	it('parses YAML frontmatter tags and dates', () => {
		const text = `---
title: "My Note"
tags:
  - alpha
  - beta
created: 2024-01-15
pinned: true
---
# Body heading

Hello [[Link]]
`;
		const fm = parseFrontmatter(text);
		expect(fm.title).toBe('My Note');
		expect(fm.tags).toEqual(['alpha', 'beta']);
		expect(fm.pinned).toBe(1);
		expect(fm.created).toBe(Date.parse('2024-01-15'));
		expect(fm.body).toContain('# Body heading');
		expect(fm.body).not.toContain('---');
	});

	it('parses inline tag arrays in frontmatter', () => {
		const fm = parseFrontmatter(`---
tags: [one, two]
---
body`);
		expect(fm.tags).toEqual(['one', 'two']);
	});

	it('extracts Bear-style inline tags', () => {
		expect(extractInlineTags('#hello world #nested/tag and #1 skip')).toEqual([
			'hello',
			'nested/tag'
		]);
	});

	it('reads first ATX heading as title fallback', () => {
		expect(firstHeadingTitle('intro\n# Real Title\nmore')).toBe('Real Title');
	});

	it('builds a note from an Obsidian-style file', () => {
		const note = markdownFileToNote({
			path: 'MyVault/Projects/ship.md',
			text: `---
tags: [ship]
---
# Ship it

See [[Other]] and #urgent
`,
			lastModified: 1_700_000_000_000
		});
		expect(note.title).toBe('Ship it');
		expect(note.folder).toBe('Projects');
		expect(note.tags).toEqual(['ship', 'urgent']);
		expect(note.links).toEqual(['Other']);
		expect(note.modified).toBe(1_700_000_000_000);
		expect(note.id).toBeTruthy();
	});

	it('imports a vault batch and skips non-md', () => {
		const result = parseMarkdownVault([
			{ path: 'V/a.md', text: '# A\n' },
			{ path: 'V/.obsidian/workspace.json', text: '{}' },
			{ path: 'V/b.md', text: '# B\n#tag' }
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.notes).toHaveLength(2);
			expect(result.skipped).toBe(1);
			expect(result.notes[1].tags).toContain('tag');
		}
	});

	it('rejects empty vaults', () => {
		expect(parseMarkdownVault([{ path: 'V/readme.txt', text: 'x' }]).ok).toBe(false);
	});

	it('adapts externally dropped text files into note imports', async () => {
		const files = await filesFromFileList(
			[new File(['Plain text body'], 'scratch.txt', { type: 'text/plain' })],
			{ allowPlainText: true }
		);
		expect(files).toEqual([
			expect.objectContaining({ path: 'scratch.md', text: 'Plain text body' })
		]);
		const result = parseMarkdownVault(files);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.notes[0]?.title).toBe('scratch');
	});
});

import { describe, expect, it } from 'vitest';
import {
	DELIMITED_MAX_CARDS,
	delimitedTableBody,
	draftsFromDelimited,
	parseDelimitedText
} from './delimited-import';

describe('delimited intake', () => {
	it('parses CSV quotes, escaped quotes, multiline cells, Unicode, and BOM', () => {
		const result = parseDelimitedText(
			'\uFEFFName,Note,Formula\r\n"Ada","Line one\nLine two","=SUM(A1:A2)"\r\n"Lin","said ""hi""","@user"',
			'people.csv'
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.analysis.headers).toEqual(['Name', 'Note', 'Formula']);
		expect(result.analysis.rows[0]).toEqual(['Ada', 'Line one\nLine two', '=SUM(A1:A2)']);
		expect(result.analysis.rows[1]?.[1]).toBe('said "hi"');
	});

	it('parses TSV and normalizes duplicate or blank headers', () => {
		const result = parseDelimitedText('Name\tName\t\nA\tB\tC', 'table.tsv');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.analysis.delimiter).toBe('\t');
		expect(result.analysis.headers).toEqual(['Name', 'Name (2)', 'Column 3']);
	});

	it('creates inert row-card text with provenance', () => {
		const result = parseDelimitedText('Name,Value\nAlpha,=2+2', 'ideas.csv');
		if (!result.ok) throw new Error(result.error);
		const drafts = draftsFromDelimited(result.analysis, 'rows', 0);
		expect(typeof drafts).not.toBe('string');
		if (typeof drafts === 'string') return;
		expect(drafts[0]).toMatchObject({
			title: 'Alpha',
			body: '**Value:** =2+2',
			source: { kind: 'table', format: 'csv', row: 1 }
		});
	});

	it('escapes markdown table separators', () => {
		const result = parseDelimitedText('Name,Value\nA,"x|y"', 'ideas.csv');
		if (!result.ok) throw new Error(result.error);
		expect(delimitedTableBody(result.analysis)).toContain('x\\|y');
	});

	it('does not silently truncate row-card imports', () => {
		const rows = Array.from({ length: DELIMITED_MAX_CARDS + 1 }, (_, index) => `Row ${index},x`);
		const result = parseDelimitedText(['Name,Value', ...rows].join('\n'), 'large.csv');
		if (!result.ok) throw new Error(result.error);
		expect(draftsFromDelimited(result.analysis, 'rows')).toMatch(/limited/);
		expect(result.analysis.suggestedMode).toBe('table');
	});

	it('rejects malformed quoted cells and binary input', () => {
		expect(parseDelimitedText('Name,Value\n"oops,x', 'bad.csv')).toEqual({
			ok: false,
			error: 'Table contains an unclosed quoted cell'
		});
		expect(parseDelimitedText('Name\0,Value', 'bad.csv').ok).toBe(false);
	});
});

import { FILE_FORMAT_LIMITS } from './file-intake';
import type { Note } from './types';

export type DelimitedFormat = 'csv' | 'tsv';
export type DelimitedImportMode = 'rows' | 'table';

export const DELIMITED_MAX_ROWS = 5000;
export const DELIMITED_MAX_COLUMNS = 100;
export const DELIMITED_MAX_CELL_CHARS = 100_000;
export const DELIMITED_MAX_CARDS = 200;
export const DELIMITED_MAX_NOTE_BODY = 500_000;

export type DelimitedAnalysis = {
	fileName: string;
	format: DelimitedFormat;
	delimiter: ',' | '\t';
	headers: string[];
	rows: string[][];
	suggestedMode: DelimitedImportMode;
	previewRows: string[][];
};

export type DelimitedDraft = {
	title: string;
	body: string;
	source: Note['source'];
};

export type DelimitedParseResult =
	{ ok: true; analysis: DelimitedAnalysis } | { ok: false; error: string };

function normalizedHeaders(raw: string[]): string[] {
	const counts = new Map<string, number>();
	return raw.map((value, index) => {
		const base = value.trim().slice(0, 200) || `Column ${index + 1}`;
		const key = base.toLocaleLowerCase();
		const count = (counts.get(key) ?? 0) + 1;
		counts.set(key, count);
		return count === 1 ? base : `${base} (${count})`;
	});
}

function isBlankRow(row: string[]): boolean {
	return row.every((cell) => cell.trim() === '');
}

function parseRows(text: string, delimiter: ',' | '\t'): string[][] | string {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let justClosedQuote = false;

	function pushCell() {
		if (cell.length > DELIMITED_MAX_CELL_CHARS) {
			throw new Error(
				`A table cell exceeds ${DELIMITED_MAX_CELL_CHARS.toLocaleString()} characters`
			);
		}
		row.push(cell);
		cell = '';
		justClosedQuote = false;
		if (row.length > DELIMITED_MAX_COLUMNS) {
			throw new Error(`Table has more than ${DELIMITED_MAX_COLUMNS} columns`);
		}
	}

	function pushRow() {
		pushCell();
		rows.push(row);
		row = [];
		if (rows.length > DELIMITED_MAX_ROWS + 1) {
			throw new Error(`Table has more than ${DELIMITED_MAX_ROWS.toLocaleString()} data rows`);
		}
	}

	try {
		for (let index = 0; index < text.length; index++) {
			const char = text[index]!;
			if (quoted) {
				if (char === '"') {
					if (text[index + 1] === '"') {
						cell += '"';
						index++;
					} else {
						quoted = false;
						justClosedQuote = true;
					}
				} else {
					cell += char;
				}
				continue;
			}

			if (char === '"' && cell.length === 0) {
				quoted = true;
				continue;
			}
			if (char === delimiter) {
				pushCell();
				continue;
			}
			if (char === '\n') {
				pushRow();
				continue;
			}
			if (justClosedQuote && char.trim() !== '') {
				throw new Error('Unexpected text after a quoted table cell');
			}
			if (!justClosedQuote) cell += char;
		}
		if (quoted) return 'Table contains an unclosed quoted cell';
		if (cell.length > 0 || row.length > 0) pushRow();
	} catch (cause) {
		return cause instanceof Error ? cause.message : 'Couldn’t parse this table';
	}

	while (rows.length > 0 && isBlankRow(rows[rows.length - 1]!)) rows.pop();
	return rows;
}

export function delimitedFormatFromFileName(fileName: string): DelimitedFormat {
	return /\.(?:tsv|tab)$/i.test(fileName.trim()) ? 'tsv' : 'csv';
}

export function parseDelimitedText(text: string, fileName: string): DelimitedParseResult {
	if (text.length > FILE_FORMAT_LIMITS.delimitedBytes) {
		return { ok: false, error: 'This table is too large to import safely (max 2 MB).' };
	}
	if (text.includes('\0'))
		return { ok: false, error: 'This table contains unsupported binary data.' };
	const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	if (!normalized.trim()) return { ok: false, error: 'This table is empty.' };
	const format = delimitedFormatFromFileName(fileName);
	const delimiter = format === 'tsv' ? '\t' : ',';
	const parsed = parseRows(normalized, delimiter);
	if (typeof parsed === 'string') return { ok: false, error: parsed };
	if (parsed.length < 2) {
		return { ok: false, error: 'This table needs a header row and at least one data row.' };
	}
	const headers = normalizedHeaders(parsed[0]!);
	const rows = parsed
		.slice(1)
		.filter((row) => !isBlankRow(row))
		.map((row) => headers.map((_, index) => row[index] ?? ''));
	if (rows.length === 0) return { ok: false, error: 'This table has no data rows.' };
	return {
		ok: true,
		analysis: {
			fileName,
			format,
			delimiter,
			headers,
			rows,
			suggestedMode: rows.length <= DELIMITED_MAX_CARDS ? 'rows' : 'table',
			previewRows: rows.slice(0, 5)
		}
	};
}

function baseTitle(fileName: string): string {
	return (
		fileName
			.replace(/^.*[/\\]/, '')
			.replace(/\.(?:csv|tsv|tab)$/i, '')
			.trim() || 'Table'
	);
}

function fieldValue(value: string): string {
	return value.trim().replace(/\n+/g, '\n  ');
}

function markdownCell(value: string): string {
	return value.trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n+/g, ' / ');
}

export function delimitedTableBody(analysis: DelimitedAnalysis): string | null {
	const header = `| ${analysis.headers.map(markdownCell).join(' | ')} |`;
	const divider = `| ${analysis.headers.map(() => '---').join(' | ')} |`;
	const rows = analysis.rows.map(
		(row) => `| ${analysis.headers.map((_, index) => markdownCell(row[index] ?? '')).join(' | ')} |`
	);
	const body = [header, divider, ...rows].join('\n');
	return body.length <= DELIMITED_MAX_NOTE_BODY ? body : null;
}

export function draftsFromDelimited(
	analysis: DelimitedAnalysis,
	mode: DelimitedImportMode,
	titleColumn = 0
): DelimitedDraft[] | string {
	if (mode === 'table') {
		const body = delimitedTableBody(analysis);
		if (!body) return 'This table is too large for one card. Split the file and try again.';
		return [
			{
				title: baseTitle(analysis.fileName).slice(0, 200),
				body,
				source: { kind: 'table', title: analysis.fileName.slice(0, 300), format: analysis.format }
			}
		];
	}

	if (analysis.rows.length > DELIMITED_MAX_CARDS) {
		return `One-card-per-row is limited to ${DELIMITED_MAX_CARDS} rows. Use one table card instead.`;
	}
	const safeTitleColumn = Math.min(Math.max(0, titleColumn), analysis.headers.length - 1);
	return analysis.rows.map((row, rowIndex) => {
		const title =
			row[safeTitleColumn]?.trim().slice(0, 200) ||
			`${baseTitle(analysis.fileName)} row ${rowIndex + 1}`;
		const lines = analysis.headers.flatMap((header, columnIndex) => {
			if (columnIndex === safeTitleColumn) return [];
			const value = fieldValue(row[columnIndex] ?? '');
			return value ? [`**${header.replace(/\*/g, '\\*')}:** ${value}`] : [];
		});
		return {
			title,
			body: lines.join('\n\n'),
			source: {
				kind: 'table' as const,
				title: analysis.fileName.slice(0, 300),
				format: analysis.format,
				row: rowIndex + 1
			}
		};
	});
}

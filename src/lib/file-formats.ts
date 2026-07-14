/**
 * User-facing file compatibility contract.
 *
 * Keep extensions, MIME hints, entry points, and top-level byte limits here so
 * pickers, drop handling, copy, and documentation do not drift independently.
 * Parser-specific limits remain with their parser.
 */
import { FILE_FORMAT_LIMITS } from './file-intake';

export {
	DROP_FORMAT_ERROR_HINT,
	DROP_FORMAT_HINT,
	FILE_ACCEPT,
	FILE_FORMAT_LIMITS
} from './file-intake';

export type FileFormatId =
	| 'markdown'
	| 'text'
	| 'notes-json'
	| 'mash-bundle'
	| 'workspace-backup'
	| 'pdf'
	| 'docx'
	| 'html'
	| 'png'
	| 'jpeg'
	| 'webp'
	| 'gif'
	| 'csv'
	| 'tsv';

export type FileEntryPoint = 'drop' | 'paste' | 'picker' | 'settings' | 'finish' | 'palette';

export type FileBehavior =
	'import' | 'open-and-clip' | 'visual-intake' | 'content-export' | 'bundle';

export interface FileFormatContract {
	id: FileFormatId;
	label: string;
	extensions: readonly string[];
	mimeTypes: readonly string[];
	entryPoints: readonly FileEntryPoint[];
	behavior: FileBehavior;
	maxBytes?: number;
	preservationLevel: 0 | 1 | 2;
}

export const FILE_FORMATS = [
	{
		id: 'markdown',
		label: 'Markdown',
		extensions: ['.md', '.markdown'],
		mimeTypes: ['text/markdown'],
		entryPoints: ['drop', 'picker', 'settings'],
		behavior: 'import',
		preservationLevel: 1
	},
	{
		id: 'text',
		label: 'Plain text',
		extensions: ['.txt'],
		mimeTypes: ['text/plain'],
		entryPoints: ['drop', 'paste'],
		behavior: 'import',
		preservationLevel: 1
	},
	{
		id: 'notes-json',
		label: 'Notes JSON',
		extensions: ['.json'],
		mimeTypes: ['application/json'],
		entryPoints: ['drop', 'picker', 'settings', 'palette'],
		behavior: 'import',
		maxBytes: FILE_FORMAT_LIMITS.notesJsonBytes,
		preservationLevel: 1
	},
	{
		id: 'mash-bundle',
		label: 'MASH desk bundle',
		extensions: ['.json'],
		mimeTypes: ['application/json'],
		entryPoints: ['drop', 'picker', 'settings', 'finish', 'palette'],
		behavior: 'bundle',
		maxBytes: FILE_FORMAT_LIMITS.deskBundleBytes,
		preservationLevel: 2
	},
	{
		id: 'workspace-backup',
		label: 'MASH workspace backup',
		extensions: ['.json'],
		mimeTypes: ['application/json'],
		entryPoints: ['drop', 'picker', 'settings', 'palette'],
		behavior: 'bundle',
		maxBytes: FILE_FORMAT_LIMITS.workspaceBackupBytes,
		preservationLevel: 2
	},
	{
		id: 'pdf',
		label: 'PDF',
		extensions: ['.pdf'],
		mimeTypes: ['application/pdf'],
		entryPoints: ['drop', 'picker', 'palette'],
		behavior: 'open-and-clip',
		maxBytes: FILE_FORMAT_LIMITS.pdfBytes,
		preservationLevel: 0
	},
	{
		id: 'docx',
		label: 'Word document',
		extensions: ['.docx'],
		mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
		entryPoints: ['drop', 'picker', 'settings', 'palette'],
		behavior: 'open-and-clip',
		maxBytes: FILE_FORMAT_LIMITS.docxBytes,
		preservationLevel: 0
	},
	{
		id: 'html',
		label: 'HTML document',
		extensions: ['.html', '.htm'],
		mimeTypes: ['text/html', 'application/xhtml+xml'],
		entryPoints: ['drop', 'picker', 'settings', 'palette'],
		behavior: 'open-and-clip',
		maxBytes: FILE_FORMAT_LIMITS.htmlBytes,
		preservationLevel: 0
	},
	{
		id: 'png',
		label: 'PNG image',
		extensions: ['.png'],
		mimeTypes: ['image/png'],
		entryPoints: ['drop', 'paste', 'picker', 'settings', 'palette'],
		behavior: 'visual-intake',
		preservationLevel: 0
	},
	{
		id: 'jpeg',
		label: 'JPEG image',
		extensions: ['.jpg', '.jpeg'],
		mimeTypes: ['image/jpeg'],
		entryPoints: ['drop', 'paste', 'picker', 'settings', 'palette'],
		behavior: 'visual-intake',
		preservationLevel: 0
	},
	{
		id: 'webp',
		label: 'WebP image',
		extensions: ['.webp'],
		mimeTypes: ['image/webp'],
		entryPoints: ['drop', 'paste', 'picker', 'settings', 'palette'],
		behavior: 'visual-intake',
		preservationLevel: 0
	},
	{
		id: 'gif',
		label: 'GIF image',
		extensions: ['.gif'],
		mimeTypes: ['image/gif'],
		entryPoints: ['drop', 'paste', 'picker', 'settings', 'palette'],
		behavior: 'visual-intake',
		preservationLevel: 0
	},
	{
		id: 'csv',
		label: 'CSV table',
		extensions: ['.csv'],
		mimeTypes: ['text/csv', 'application/csv'],
		entryPoints: ['drop', 'picker', 'settings', 'palette'],
		behavior: 'import',
		maxBytes: FILE_FORMAT_LIMITS.delimitedBytes,
		preservationLevel: 0
	},
	{
		id: 'tsv',
		label: 'TSV table',
		extensions: ['.tsv', '.tab'],
		mimeTypes: ['text/tab-separated-values'],
		entryPoints: ['drop', 'picker', 'settings', 'palette'],
		behavior: 'import',
		maxBytes: FILE_FORMAT_LIMITS.delimitedBytes,
		preservationLevel: 0
	}
] as const satisfies readonly FileFormatContract[];

export function fileFormat(id: FileFormatId): FileFormatContract {
	const format = FILE_FORMATS.find((candidate) => candidate.id === id);
	if (!format) throw new Error(`Unknown file format: ${id}`);
	return format;
}

export function acceptFor(ids: readonly FileFormatId[]): string {
	const values = ids.flatMap((id) => {
		const format = fileFormat(id);
		return [...format.extensions, ...format.mimeTypes];
	});
	return [...new Set(values)].join(',');
}

export function fileMatchesFormat(file: Pick<File, 'name' | 'type'>, id: FileFormatId): boolean {
	const format = fileFormat(id);
	const name = file.name.trim().toLowerCase();
	const mime = file.type.trim().toLowerCase();
	return (
		format.extensions.some((extension) => name.endsWith(extension)) ||
		(Boolean(mime) && format.mimeTypes.includes(mime))
	);
}

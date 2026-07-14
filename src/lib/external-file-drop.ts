import { fileMatchesFormat } from './file-formats';

export type ExternalImportKind =
	'note-text' | 'json' | 'pdf' | 'docx' | 'html' | 'image' | 'delimited' | 'unsupported';

export type ExternalImportBatch = {
	noteTextFiles: File[];
	jsonFiles: File[];
	pdfFiles: File[];
	docxFiles: File[];
	htmlFiles: File[];
	imageFiles: File[];
	delimitedFiles: File[];
	unsupportedFiles: File[];
};

/** Formats Mash can safely turn into notes or an existing validated import. */
export function externalImportKind(file: Pick<File, 'name' | 'type'>): ExternalImportKind {
	if (fileMatchesFormat(file, 'markdown') || fileMatchesFormat(file, 'text')) return 'note-text';
	if (fileMatchesFormat(file, 'notes-json')) return 'json';
	if (fileMatchesFormat(file, 'pdf')) return 'pdf';
	if (fileMatchesFormat(file, 'docx')) return 'docx';
	if (fileMatchesFormat(file, 'html')) return 'html';
	if (
		fileMatchesFormat(file, 'png') ||
		fileMatchesFormat(file, 'jpeg') ||
		fileMatchesFormat(file, 'webp') ||
		fileMatchesFormat(file, 'gif')
	)
		return 'image';
	if (fileMatchesFormat(file, 'csv') || fileMatchesFormat(file, 'tsv')) return 'delimited';
	return 'unsupported';
}

export function splitExternalImportFiles(files: File[]): ExternalImportBatch {
	const batch: ExternalImportBatch = {
		noteTextFiles: [],
		jsonFiles: [],
		pdfFiles: [],
		docxFiles: [],
		htmlFiles: [],
		imageFiles: [],
		delimitedFiles: [],
		unsupportedFiles: []
	};
	for (const file of files) {
		const kind = externalImportKind(file);
		if (kind === 'note-text') batch.noteTextFiles.push(file);
		else if (kind === 'json') batch.jsonFiles.push(file);
		else if (kind === 'pdf') batch.pdfFiles.push(file);
		else if (kind === 'docx') batch.docxFiles.push(file);
		else if (kind === 'html') batch.htmlFiles.push(file);
		else if (kind === 'image') batch.imageFiles.push(file);
		else if (kind === 'delimited') batch.delimitedFiles.push(file);
		else batch.unsupportedFiles.push(file);
	}
	return batch;
}

/** Distinguish content exports, active-desk bundles, and whole-workspace backups. */
export function detectJsonImportKind(
	text: string
): 'notes' | 'sync' | 'workspace-backup' | 'invalid' {
	try {
		const value: unknown = JSON.parse(text);
		if (Array.isArray(value)) return 'notes';
		if (
			typeof value === 'object' &&
			value !== null &&
			'kind' in value &&
			(value as { kind?: unknown }).kind === 'mash-backup' &&
			'scope' in value &&
			(value as { scope?: unknown }).scope === 'workspace'
		) {
			return 'workspace-backup';
		}
		if (
			typeof value === 'object' &&
			value !== null &&
			'version' in value &&
			'notes' in value &&
			Array.isArray((value as { notes?: unknown }).notes)
		) {
			return 'sync';
		}
		return 'invalid';
	} catch {
		return 'invalid';
	}
}

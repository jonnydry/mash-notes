export type ExternalImportKind =
	'note-text' | 'json' | 'pdf' | 'docx' | 'html' | 'image' | 'unsupported';

export type ExternalImportBatch = {
	noteTextFiles: File[];
	jsonFiles: File[];
	pdfFiles: File[];
	docxFiles: File[];
	htmlFiles: File[];
	imageFiles: File[];
	unsupportedFiles: File[];
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const HTML_MIME = /^(text\/html|application\/xhtml\+xml)$/i;

/** Formats Mash can safely turn into notes or an existing validated import. */
export function externalImportKind(file: Pick<File, 'name' | 'type'>): ExternalImportKind {
	const name = file.name.trim().toLowerCase();
	const type = file.type.toLowerCase();
	if (/\.(md|markdown|txt)$/.test(name)) return 'note-text';
	if (/\.json$/.test(name) || type === 'application/json') return 'json';
	if (/\.pdf$/.test(name) || type === 'application/pdf') return 'pdf';
	if (/\.docx$/.test(name) || type === DOCX_MIME) return 'docx';
	if (/\.html?$/.test(name) || HTML_MIME.test(type)) return 'html';
	if (IMAGE_EXT.test(name) || IMAGE_MIME.test(type)) return 'image';
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
		else batch.unsupportedFiles.push(file);
	}
	return batch;
}

/** JSON arrays are note exports; versioned objects with notes are sync bundles. */
export function detectJsonImportKind(text: string): 'notes' | 'sync' | 'invalid' {
	try {
		const value: unknown = JSON.parse(text);
		if (Array.isArray(value)) return 'notes';
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

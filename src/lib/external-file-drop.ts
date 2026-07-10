export type ExternalImportKind = 'note-text' | 'json' | 'pdf' | 'unsupported';

export type ExternalImportBatch = {
	noteTextFiles: File[];
	jsonFiles: File[];
	pdfFiles: File[];
	unsupportedFiles: File[];
};

/** Formats Mash can safely turn into notes or an existing validated import. */
export function externalImportKind(file: Pick<File, 'name' | 'type'>): ExternalImportKind {
	const name = file.name.trim().toLowerCase();
	if (/\.(md|markdown|txt)$/.test(name)) return 'note-text';
	if (/\.json$/.test(name) || file.type.toLowerCase() === 'application/json') return 'json';
	if (/\.pdf$/.test(name) || file.type.toLowerCase() === 'application/pdf') return 'pdf';
	return 'unsupported';
}

export function splitExternalImportFiles(files: File[]): ExternalImportBatch {
	const batch: ExternalImportBatch = {
		noteTextFiles: [],
		jsonFiles: [],
		pdfFiles: [],
		unsupportedFiles: []
	};
	for (const file of files) {
		const kind = externalImportKind(file);
		if (kind === 'note-text') batch.noteTextFiles.push(file);
		else if (kind === 'json') batch.jsonFiles.push(file);
		else if (kind === 'pdf') batch.pdfFiles.push(file);
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

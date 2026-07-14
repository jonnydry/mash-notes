/** Lightweight projections used by always-on UI and bounded intake paths. */
export const FILE_FORMAT_LIMITS = {
	notesJsonBytes: 8_000_000,
	deskBundleBytes: 8_000_000,
	workspaceBackupBytes: 50_000_000,
	pdfBytes: 50 * 1024 * 1024,
	docxBytes: 8_000_000,
	htmlBytes: 5 * 1024 * 1024,
	delimitedBytes: 2 * 1024 * 1024
} as const;

/**
 * Precomputed from the canonical registry so routine page load does not pull
 * every format label and entry-point description into the initial bundle.
 * Contract tests assert that these stay byte-for-byte aligned with acceptFor().
 */
export const FILE_ACCEPT = {
	json: '.json,application/json',
	pdf: '.pdf,application/pdf',
	docx: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	html: '.html,.htm,text/html,application/xhtml+xml',
	images: '.png,image/png,.jpg,.jpeg,image/jpeg,.webp,image/webp,.gif,image/gif',
	markdownVault: '.md,.markdown,text/markdown',
	delimited: '.csv,text/csv,application/csv,.tsv,.tab,text/tab-separated-values'
} as const;

export const DROP_FORMAT_HINT = 'PDF, Word, HTML, images, Markdown, text, CSV/TSV, or MASH JSON';

export const DROP_FORMAT_ERROR_HINT =
	'try PNG, JPEG, WebP, GIF, PDF, Word, HTML, Markdown, text, CSV/TSV, or MASH JSON';

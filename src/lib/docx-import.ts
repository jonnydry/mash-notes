export const MAX_DOCX_BYTES = 8_000_000;

export type DocxConvertResult =
	| { ok: true; html: string; title: string }
	| { ok: false; error: string };

export function docxTitleFromFileName(name: string): string {
	const base = name.replace(/\.docx$/i, '').trim();
	return base || 'Untitled document';
}

function stripTagsToText(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Convert a local user-chosen .docx ArrayBuffer to HTML via mammoth.
 * Images are omitted (v1). Lazy-loads mammoth so it stays out of the main bundle path.
 */
export async function convertDocxToHtml(
	buffer: ArrayBuffer,
	fileName: string
): Promise<DocxConvertResult> {
	const title = docxTitleFromFileName(fileName);
	if (buffer.byteLength > MAX_DOCX_BYTES) {
		return { ok: false, error: 'This Word document is too large to open (max 8MB).' };
	}
	if (buffer.byteLength === 0) {
		return { ok: false, error: 'Couldn’t open this Word document.' };
	}
	try {
		const mammothModule = await import('mammoth');
		// CJS interop: vitest/node may expose the API on `.default`.
		const mammoth = (mammothModule as { default?: typeof mammothModule }).default ?? mammothModule;
		// Node mammoth accepts `buffer`; the browser build accepts `arrayBuffer`.
		const input =
			typeof Buffer !== 'undefined'
				? { buffer: Buffer.from(buffer), arrayBuffer: buffer }
				: { arrayBuffer: buffer };
		const result = await mammoth.convertToHtml(input, {
			includeDefaultStyleMap: true,
			// Omit embedded images in v1 (default mammoth.images.dataUri inlines data: URIs).
			// mammoth brands ImageConverter; returning [] is intentional and not in public types.
			convertImage: (() => Promise.resolve([])) as unknown as typeof mammoth.images.dataUri
		});
		const html = (result.value ?? '').trim();
		if (!html || !stripTagsToText(html)) {
			return { ok: false, error: 'No readable text in this document.' };
		}
		return { ok: true, html, title };
	} catch (cause) {
		console.error(cause);
		return { ok: false, error: 'Couldn’t open this Word document.' };
	}
}

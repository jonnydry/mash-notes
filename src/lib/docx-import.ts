export const MAX_DOCX_BYTES = 8_000_000;
const MAX_DOCX_ENTRIES = 5000;
const MAX_DOCX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_HTML_CHARS = 16_000_000;
const MAX_DOCX_IMAGES = 200;
const MAX_DOCX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_IMAGE_BYTES_TOTAL = 12 * 1024 * 1024;
const MAX_DOCX_IMAGE_PIXELS = 16_777_216;
const MAX_DOCX_IMAGE_PIXELS_TOTAL = 67_108_864;
const MAX_DOCX_IMAGE_EDGE = 8192;
const DOCX_RASTER_MIME = /^image\/(?:png|jpeg|gif|webp)$/i;

export type DocxConvertResult =
	{ ok: true; html: string; title: string } | { ok: false; error: string };

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

async function hasSafeArchiveShape(buffer: ArrayBuffer): Promise<boolean> {
	const jszipModule = await import('jszip');
	const JSZip = jszipModule.default;
	const zip = await JSZip.loadAsync(buffer);
	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	if (entries.length > MAX_DOCX_ENTRIES) return false;
	let total = 0;
	for (const entry of entries) {
		const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
			?.uncompressedSize;
		if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return false;
		if (size > MAX_DOCX_ENTRY_BYTES) return false;
		total += size;
		if (total > MAX_DOCX_UNCOMPRESSED_BYTES) return false;
	}
	return true;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 32_768;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

/**
 * Convert a local user-chosen .docx ArrayBuffer to HTML via mammoth.
 * Embedded images are inlined as data URIs. Lazy-loads mammoth so it stays out of the main bundle path.
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
		if (!(await hasSafeArchiveShape(buffer))) {
			return { ok: false, error: 'This Word document expands beyond the safe opening limit.' };
		}
		const mammothModule = await import('mammoth');
		// CJS interop: vitest/node may expose the API on `.default`.
		const mammoth =
			(mammothModule as unknown as { default?: typeof mammothModule }).default ?? mammothModule;
		// Node mammoth accepts `buffer`; the browser build accepts `arrayBuffer`.
		const input =
			typeof Buffer !== 'undefined'
				? { buffer: Buffer.from(buffer), arrayBuffer: buffer }
				: { arrayBuffer: buffer };
		let imageCount = 0;
		let imageBytesTotal = 0;
		let imagePixelsTotal = 0;
		const convertImage = mammoth.images.imgElement(async (image) => {
			imageCount += 1;
			if (imageCount > MAX_DOCX_IMAGES || !DOCX_RASTER_MIME.test(image.contentType)) {
				throw new Error('Embedded image exceeds the safe opening limit');
			}
			const imageBuffer = await image.readAsArrayBuffer();
			imageBytesTotal += imageBuffer.byteLength;
			if (
				imageBuffer.byteLength > MAX_DOCX_IMAGE_BYTES ||
				imageBytesTotal > MAX_DOCX_IMAGE_BYTES_TOTAL
			) {
				throw new Error('Embedded image exceeds the safe opening limit');
			}
			const { readEncodedImageDimensions } = await import('./image-headers');
			const dimensions = await readEncodedImageDimensions(
				new Blob([imageBuffer], { type: image.contentType })
			);
			const pixels = (dimensions?.width ?? 0) * (dimensions?.height ?? 0);
			imagePixelsTotal += pixels;
			if (
				!dimensions ||
				dimensions.width < 1 ||
				dimensions.height < 1 ||
				dimensions.width > MAX_DOCX_IMAGE_EDGE ||
				dimensions.height > MAX_DOCX_IMAGE_EDGE ||
				pixels > MAX_DOCX_IMAGE_PIXELS ||
				imagePixelsTotal > MAX_DOCX_IMAGE_PIXELS_TOTAL
			) {
				throw new Error('Embedded image exceeds the safe opening limit');
			}
			return {
				src: `data:${image.contentType.toLowerCase()};base64,${bytesToBase64(new Uint8Array(imageBuffer))}`
			};
		});
		const result = await mammoth.convertToHtml(input, {
			includeDefaultStyleMap: true,
			convertImage
		});
		const html = (result.value ?? '').trim();
		if (html.length > MAX_DOCX_HTML_CHARS) {
			return { ok: false, error: 'This Word document expands beyond the safe opening limit.' };
		}
		if (!html || (!stripTagsToText(html) && !/<img\b/i.test(html))) {
			return { ok: false, error: 'No readable text in this document.' };
		}
		return { ok: true, html, title };
	} catch (cause) {
		console.error(cause);
		return { ok: false, error: 'Couldn’t open this Word document.' };
	}
}

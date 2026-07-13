const IMAGE_HEADER_READ_BYTES = 1024 * 1024;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 8 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset++;
			continue;
		}
		let marker = bytes[offset + 1]!;
		while (marker === 0xff && offset + 2 < bytes.length) {
			offset++;
			marker = bytes[offset + 1]!;
		}
		offset += 2;
		if (marker === 0xd9 || marker === 0xda) break;
		if (marker >= 0xd0 && marker <= 0xd7) continue;
		if (offset + 2 > bytes.length) break;
		const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
		if (length < 2 || offset + length > bytes.length) break;
		const isStartOfFrame =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isStartOfFrame && length >= 7) {
			return {
				height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
				width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!
			};
		}
		offset += length;
	}
	return null;
}

/** Read dimensions without asking the browser to allocate decoded pixel memory. */
export async function readEncodedImageDimensions(
	input: Blob
): Promise<{ width: number; height: number } | null> {
	const bytes = new Uint8Array(
		await input.slice(0, Math.min(input.size, IMAGE_HEADER_READ_BYTES)).arrayBuffer()
	);
	if (
		bytes.length >= 24 &&
		bytes[0] === 0x89 &&
		ascii(bytes, 1, 3) === 'PNG' &&
		ascii(bytes, 12, 4) === 'IHDR'
	) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}
	if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
		return {
			width: bytes[6]! | (bytes[7]! << 8),
			height: bytes[8]! | (bytes[9]! << 8)
		};
	}
	const jpeg = jpegDimensions(bytes);
	if (jpeg) return jpeg;
	if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
		const kind = ascii(bytes, 12, 4);
		if (kind === 'VP8X') {
			return {
				width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
				height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16)
			};
		}
		if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
			return {
				width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
				height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff
			};
		}
		if (kind === 'VP8L' && bytes[20] === 0x2f) {
			const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
			return {
				width: 1 + (bits & 0x3fff),
				height: 1 + ((bits >>> 14) & 0x3fff)
			};
		}
	}
	return null;
}

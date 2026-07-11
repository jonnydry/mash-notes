/** Keep the reader's large engine and stylesheet behind a second lazy boundary. */
export async function loadPdfReader() {
	return (await import('$lib/components/PdfReader.svelte')).default;
}

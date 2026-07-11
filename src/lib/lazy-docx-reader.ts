/** Keep mammoth + reader UI behind a lazy boundary. */
export async function loadDocxReader() {
	return (await import('$lib/components/DocxReader.svelte')).default;
}

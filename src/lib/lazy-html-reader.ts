/** Keep HTML reader UI behind a lazy boundary. */
export async function loadHtmlReader() {
	return (await import('$lib/components/HtmlReader.svelte')).default;
}

/**
 * PDF / Word / HTML document readers — open state, lazy modules, clippings lists.
 * Note creation on clip stays with the page (library ownership).
 */
import type { Component } from 'svelte';
import type { DocxClipping } from '$lib/docx-clipping';
import type { HtmlClipping } from '$lib/html-clipping';
import type { PdfClipping } from '$lib/pdf-clipping';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_BYTES = 8_000_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

export type DocumentReadersOpts = {
	flashToast: (msg: string, ms?: number) => void;
	/** Close peel, selection, sticky expand, stage, palette, settings before opening a reader. */
	prepareForReader: () => void;
};

export function createDocumentReaders(opts: DocumentReadersOpts) {
	let pdfReaderFile = $state<File | null>(null);
	let pdfReaderOpen = $state(false);
	let pdfReaderView = $state({ page: 1, zoom: 1 });
	let LazyPdfReader = $state<Component | null>(null);
	let pdfReaderModuleLoading = $state(false);
	let pdfClippings = $state<PdfClipping[]>([]);

	let docxReaderFile = $state<File | null>(null);
	let docxReaderOpen = $state(false);
	let LazyDocxReader = $state<Component | null>(null);
	let docxReaderModulePromise: Promise<void> | null = null;
	let docxClippings = $state<DocxClipping[]>([]);

	let htmlReaderFile = $state<File | null>(null);
	let htmlReaderOpen = $state(false);
	let LazyHtmlReader = $state<Component | null>(null);
	let htmlReaderModuleLoading = $state(false);
	let htmlClippings = $state<HtmlClipping[]>([]);

	const documentReaderOpen = $derived(pdfReaderOpen || docxReaderOpen || htmlReaderOpen);

	function prepareChrome() {
		opts.prepareForReader();
	}

	async function ensurePdfReaderModule() {
		if (LazyPdfReader || pdfReaderModuleLoading) return;
		pdfReaderModuleLoading = true;
		try {
			const { loadPdfReader } = await import('$lib/lazy-pdf-reader');
			LazyPdfReader = (await loadPdfReader()) as Component;
		} catch (error) {
			console.error('Failed to load PDF tools', error);
			pdfReaderOpen = false;
			opts.flashToast('PDF tools could not be loaded. Check your connection and try again.');
		} finally {
			pdfReaderModuleLoading = false;
		}
	}

	async function ensureDocxReaderModule() {
		if (LazyDocxReader) return;
		if (docxReaderModulePromise) return docxReaderModulePromise;
		docxReaderModulePromise = (async () => {
			try {
				const { loadDocxReader } = await import('$lib/lazy-docx-reader');
				LazyDocxReader = (await loadDocxReader()) as Component;
			} catch (error) {
				console.error('Failed to load Word document tools', error);
				docxReaderOpen = false;
				opts.flashToast('Couldn’t load Word document tools', 3600);
			} finally {
				docxReaderModulePromise = null;
			}
		})();
		return docxReaderModulePromise;
	}

	async function ensureHtmlReaderModule() {
		if (LazyHtmlReader || htmlReaderModuleLoading) return;
		htmlReaderModuleLoading = true;
		try {
			const { loadHtmlReader } = await import('$lib/lazy-html-reader');
			LazyHtmlReader = (await loadHtmlReader()) as Component;
		} catch (error) {
			console.error('Failed to load HTML document tools', error);
			htmlReaderOpen = false;
			opts.flashToast('Couldn’t load HTML document tools', 3600);
		} finally {
			htmlReaderModuleLoading = false;
		}
	}

	function openPdfReader(file: File) {
		if (file.size > MAX_PDF_BYTES) {
			opts.flashToast('This PDF is too large to open safely (max 50 MB).', 3600);
			return false;
		}
		pdfReaderFile = file;
		pdfReaderOpen = true;
		docxReaderOpen = false;
		htmlReaderOpen = false;
		pdfReaderView = { page: 1, zoom: 1 };
		pdfClippings = [];
		prepareChrome();
		void ensurePdfReaderModule();
		return true;
	}

	async function openDocxReader(file: File) {
		if (file.size > MAX_DOCX_BYTES) {
			opts.flashToast('This Word document is too large to open safely (max 8 MB).', 3600);
			return false;
		}
		docxReaderFile = file;
		docxReaderOpen = true;
		pdfReaderOpen = false;
		htmlReaderOpen = false;
		docxClippings = [];
		prepareChrome();
		await ensureDocxReaderModule();
		return Boolean(LazyDocxReader);
	}

	function openHtmlReader(file: File) {
		if (file.size > MAX_HTML_BYTES) {
			opts.flashToast('This HTML document is too large to open safely (max 5 MB).', 3600);
			return false;
		}
		htmlReaderFile = file;
		htmlReaderOpen = true;
		pdfReaderOpen = false;
		docxReaderOpen = false;
		htmlClippings = [];
		prepareChrome();
		void ensureHtmlReaderModule();
		return true;
	}

	function resumePdfReader() {
		if (!pdfReaderFile) return;
		pdfReaderOpen = true;
		docxReaderOpen = false;
		htmlReaderOpen = false;
		prepareChrome();
		void ensurePdfReaderModule();
	}

	function resumeDocxReader() {
		if (!docxReaderFile) return;
		docxReaderOpen = true;
		pdfReaderOpen = false;
		htmlReaderOpen = false;
		prepareChrome();
		void ensureDocxReaderModule();
	}

	function resumeHtmlReader() {
		if (!htmlReaderFile) return;
		htmlReaderOpen = true;
		pdfReaderOpen = false;
		docxReaderOpen = false;
		prepareChrome();
		void ensureHtmlReaderModule();
	}

	function hidePdfReader() {
		pdfReaderOpen = false;
	}
	function hideDocxReader() {
		docxReaderOpen = false;
	}
	function hideHtmlReader() {
		htmlReaderOpen = false;
	}

	return {
		get pdfReaderFile() {
			return pdfReaderFile;
		},
		get pdfReaderOpen() {
			return pdfReaderOpen;
		},
		set pdfReaderOpen(v: boolean) {
			pdfReaderOpen = v;
		},
		get pdfReaderView() {
			return pdfReaderView;
		},
		set pdfReaderView(v: { page: number; zoom: number }) {
			pdfReaderView = v;
		},
		get LazyPdfReader() {
			return LazyPdfReader;
		},
		get pdfClippings() {
			return pdfClippings;
		},
		set pdfClippings(v: PdfClipping[]) {
			pdfClippings = v;
		},
		get docxReaderFile() {
			return docxReaderFile;
		},
		get docxReaderOpen() {
			return docxReaderOpen;
		},
		set docxReaderOpen(v: boolean) {
			docxReaderOpen = v;
		},
		get LazyDocxReader() {
			return LazyDocxReader;
		},
		get docxClippings() {
			return docxClippings;
		},
		set docxClippings(v: DocxClipping[]) {
			docxClippings = v;
		},
		get htmlReaderFile() {
			return htmlReaderFile;
		},
		get htmlReaderOpen() {
			return htmlReaderOpen;
		},
		set htmlReaderOpen(v: boolean) {
			htmlReaderOpen = v;
		},
		get LazyHtmlReader() {
			return LazyHtmlReader;
		},
		get htmlClippings() {
			return htmlClippings;
		},
		set htmlClippings(v: HtmlClipping[]) {
			htmlClippings = v;
		},
		get documentReaderOpen() {
			return documentReaderOpen;
		},
		openPdfReader,
		openDocxReader,
		openHtmlReader,
		resumePdfReader,
		resumeDocxReader,
		resumeHtmlReader,
		hidePdfReader,
		hideDocxReader,
		hideHtmlReader
	};
}

export type DocumentReaders = ReturnType<typeof createDocumentReaders>;

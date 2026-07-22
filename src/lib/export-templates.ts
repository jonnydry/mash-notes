import type {
	ExportPageSize,
	ExportTemplateId,
	PresentationExportOptions,
	PresentationFormat
} from './export-document';

export type ExportTemplate = {
	id: ExportTemplateId;
	name: string;
	summary: string;
	bestFor: string;
	flow: 'continuous' | 'page-per-note';
	previewClass: string;
	colors: {
		paper: string;
		ink: string;
		muted: string;
		accent: string;
		wash: string;
		border: string;
	};
};

export const EXPORT_TEMPLATES: ExportTemplate[] = [
	{
		id: 'clean',
		name: 'Clean',
		summary: 'Quiet hierarchy and generous breathing room.',
		bestFor: 'Handoffs and everyday notes',
		flow: 'continuous',
		previewClass: 'is-clean',
		colors: {
			paper: '#ffffff',
			ink: '#18211d',
			muted: '#66716c',
			accent: '#16856b',
			wash: '#edf8f3',
			border: '#dfe8e3'
		}
	},
	{
		id: 'editorial',
		name: 'Editorial',
		summary: 'A reading-first layout with expressive section titles.',
		bestFor: 'Briefs, essays, and research',
		flow: 'continuous',
		previewClass: 'is-editorial',
		colors: {
			paper: '#fbf7ef',
			ink: '#29241e',
			muted: '#756b5f',
			accent: '#a1462f',
			wash: '#f1e5d6',
			border: '#ddcfbd'
		}
	},
	{
		id: 'sticky-deck',
		name: 'Sticky deck',
		summary: 'One bold Mash card per page.',
		bestFor: 'Sequences, workshops, and storyboards',
		flow: 'page-per-note',
		previewClass: 'is-sticky-deck',
		colors: {
			paper: '#f4f0e8',
			ink: '#17322a',
			muted: '#63746d',
			accent: '#1b8f72',
			wash: '#dff4e9',
			border: '#afd8c6'
		}
	}
];

export const EXPORT_PAGE_SIZES: Record<
	ExportPageSize,
	{ label: string; width: number; height: number }
> = {
	letter: { label: 'Letter', width: 612, height: 792 },
	a4: { label: 'A4', width: 595.28, height: 841.89 }
};

const PREF_KEY = 'mash.presentationExport.v1';

export function exportTemplate(id: ExportTemplateId): ExportTemplate {
	return EXPORT_TEMPLATES.find((template) => template.id === id) ?? EXPORT_TEMPLATES[0]!;
}

export function defaultPresentationExportOptions(
	format: PresentationFormat,
	documentTitle: string,
	sectionCount = 1
): PresentationExportOptions {
	return {
		format,
		templateId: 'clean',
		pageSize: 'letter',
		includeCover: sectionCount > 1,
		includeMetadata: true,
		includePageNumbers: true,
		documentTitle: documentTitle.trim() || 'Mash export'
	};
}

export function loadPresentationExportOptions(
	format: PresentationFormat,
	documentTitle: string,
	sectionCount = 1
): PresentationExportOptions {
	const fallback = defaultPresentationExportOptions(format, documentTitle, sectionCount);
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const parsed = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<
			Record<PresentationFormat, Partial<PresentationExportOptions>>
		>;
		const saved = parsed[format];
		const validTemplate = EXPORT_TEMPLATES.some((template) => template.id === saved?.templateId);
		return {
			...fallback,
			...(saved ?? {}),
			format,
			documentTitle: fallback.documentTitle,
			templateId: validTemplate ? saved!.templateId! : fallback.templateId,
			pageSize: saved?.pageSize === 'a4' ? 'a4' : 'letter'
		};
	} catch {
		return fallback;
	}
}

export function savePresentationExportOptions(options: PresentationExportOptions): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const existing = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, unknown>;
		localStorage.setItem(
			PREF_KEY,
			JSON.stringify({
				...existing,
				[options.format]: {
					templateId: options.templateId,
					pageSize: options.pageSize,
					includeCover: options.includeCover,
					includeMetadata: options.includeMetadata,
					includePageNumbers: options.includePageNumbers
				}
			})
		);
	} catch {
		/* Preferences are optional. */
	}
}

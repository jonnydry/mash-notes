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
	descriptor: string;
	bestFor: string;
	flow: 'continuous' | 'page-per-note';
	typeStyle: 'sans' | 'serif' | 'mixed';
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
		id: 'plain',
		name: 'Plain',
		summary: 'No visual template—just a clean, neutral document.',
		descriptor: 'No template',
		bestFor: 'Simple, unstyled output',
		flow: 'continuous',
		typeStyle: 'sans',
		previewClass: 'is-plain',
		colors: {
			paper: '#ffffff',
			ink: '#202020',
			muted: '#686868',
			accent: '#202020',
			wash: '#f5f5f5',
			border: '#d8d8d8'
		}
	},
	{
		id: 'classic',
		name: 'Classic',
		summary: 'Quiet, balanced, and universally useful.',
		descriptor: 'Timeless / clean',
		bestFor: 'Handoffs and polished notes',
		flow: 'continuous',
		typeStyle: 'mixed',
		previewClass: 'is-classic',
		colors: {
			paper: '#ffffff',
			ink: '#19211e',
			muted: '#68726e',
			accent: '#147b62',
			wash: '#eef7f3',
			border: '#d9e5df'
		}
	},
	{
		id: 'journal',
		name: 'Journal',
		summary: 'Warm, literary, and made for long reads.',
		descriptor: 'Warm / narrative',
		bestFor: 'Essays, research, and reflection',
		flow: 'continuous',
		typeStyle: 'serif',
		previewClass: 'is-journal',
		colors: {
			paper: '#fbf7ef',
			ink: '#2d2822',
			muted: '#786d61',
			accent: '#a14b35',
			wash: '#f1e5d6',
			border: '#ddcfbd'
		}
	},
	{
		id: 'swiss',
		name: 'Swiss',
		summary: 'Asymmetric grid with graphic clarity.',
		descriptor: 'Structured / modern',
		bestFor: 'Strategy, systems, and presentations',
		flow: 'continuous',
		typeStyle: 'sans',
		previewClass: 'is-swiss',
		colors: {
			paper: '#ffffff',
			ink: '#101411',
			muted: '#66706a',
			accent: '#1b916f',
			wash: '#eaf6f1',
			border: '#161b18'
		}
	},
	{
		id: 'monograph',
		name: 'Monograph',
		summary: 'Bold type and chapter-like pacing.',
		descriptor: 'Typographic / bold',
		bestFor: 'Concepts, portfolios, and narratives',
		flow: 'page-per-note',
		typeStyle: 'mixed',
		previewClass: 'is-monograph',
		colors: {
			paper: '#f1eee4',
			ink: '#151412',
			muted: '#716d62',
			accent: '#35573f',
			wash: '#ded9ca',
			border: '#bcb6a7'
		}
	},
	{
		id: 'studio',
		name: 'Studio',
		summary: 'Spacious, image-friendly, and directional.',
		descriptor: 'Visual / spacious',
		bestFor: 'Creative briefs and visual thinking',
		flow: 'continuous',
		typeStyle: 'sans',
		previewClass: 'is-studio',
		colors: {
			paper: '#fcfbf7',
			ink: '#172019',
			muted: '#6d766e',
			accent: '#e36c3d',
			wash: '#f6e7de',
			border: '#e2d8cf'
		}
	},
	{
		id: 'cards',
		name: 'Cards',
		summary: 'One expressive Mash card per page.',
		descriptor: 'Compact / modular',
		bestFor: 'Workshops, sequences, and storyboards',
		flow: 'page-per-note',
		typeStyle: 'sans',
		previewClass: 'is-cards',
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

const LEGACY_TEMPLATE_IDS: Record<string, ExportTemplateId> = {
	clean: 'classic',
	editorial: 'journal',
	'sticky-deck': 'cards'
};

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
		templateId: 'classic',
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
		const savedTemplate = saved?.templateId;
		const migratedTemplate =
			typeof savedTemplate === 'string'
				? (LEGACY_TEMPLATE_IDS[savedTemplate] ?? savedTemplate)
				: fallback.templateId;
		const validTemplate = EXPORT_TEMPLATES.some((template) => template.id === migratedTemplate);
		return {
			...fallback,
			...(saved ?? {}),
			format,
			documentTitle: fallback.documentTitle,
			templateId: validTemplate ? (migratedTemplate as ExportTemplateId) : fallback.templateId,
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

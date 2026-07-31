import { describe, expect, it } from 'vitest';
import {
	defaultPresentationExportOptions,
	EXPORT_PAGE_SIZES,
	EXPORT_TEMPLATES,
	exportTemplate
} from './export-templates';

describe('export templates', () => {
	it('offers a plain document plus six structurally distinct stable templates', () => {
		expect(EXPORT_TEMPLATES.map((template) => template.id)).toEqual([
			'plain',
			'classic',
			'journal',
			'swiss',
			'monograph',
			'studio',
			'cards'
		]);
		expect(exportTemplate('cards').flow).toBe('page-per-note');
		expect(exportTemplate('monograph').flow).toBe('page-per-note');
		expect(exportTemplate('plain').colors.accent).toBe(exportTemplate('plain').colors.ink);
		expect(new Set(EXPORT_TEMPLATES.map((template) => template.colors.accent)).size).toBe(7);
	});

	it('defaults multi-note PDF export to a classic covered Letter document', () => {
		expect(defaultPresentationExportOptions('pdf', 'Brief', 3)).toMatchObject({
			format: 'pdf',
			templateId: 'classic',
			pageSize: 'letter',
			includeCover: true,
			documentTitle: 'Brief'
		});
		expect(EXPORT_PAGE_SIZES.a4.height).toBeGreaterThan(EXPORT_PAGE_SIZES.letter.height);
	});
});

import { describe, expect, it } from 'vitest';
import {
	defaultPresentationExportOptions,
	EXPORT_PAGE_SIZES,
	EXPORT_TEMPLATES,
	exportTemplate
} from './export-templates';

describe('export templates', () => {
	it('offers three structurally distinct stable templates', () => {
		expect(EXPORT_TEMPLATES.map((template) => template.id)).toEqual([
			'clean',
			'editorial',
			'sticky-deck'
		]);
		expect(exportTemplate('sticky-deck').flow).toBe('page-per-note');
		expect(new Set(EXPORT_TEMPLATES.map((template) => template.colors.accent)).size).toBe(3);
	});

	it('defaults multi-note PDF export to a clean covered Letter document', () => {
		expect(defaultPresentationExportOptions('pdf', 'Brief', 3)).toMatchObject({
			format: 'pdf',
			templateId: 'clean',
			pageSize: 'letter',
			includeCover: true,
			documentTitle: 'Brief'
		});
		expect(EXPORT_PAGE_SIZES.a4.height).toBeGreaterThan(EXPORT_PAGE_SIZES.letter.height);
	});
});

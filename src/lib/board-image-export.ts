import type { CanvasColor, CanvasEdge, CanvasElement, CanvasItem, Note, TextAlign } from './types';
import { canvasArrowPath } from './canvas-element-geometry';
import { canvasElementItemIds, cloneCanvasElement } from './canvas-elements';

const DEFAULT_CARD = { w: 220, h: 120 };
const CARD_GAP = 24;
const BOARD_PADDING = 48;
const SYNTHETIC_COLUMNS = 4;
export const BOARD_IMAGE_MAX_DIMENSION = 4096;
export const BOARD_IMAGE_MAX_PIXELS = 12_000_000;

export type BoardImageTheme = 'dark' | 'light';

export type BoardImageCard = {
	itemId: string;
	noteId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	title: string;
	preview: string;
	textAlign: TextAlign;
	pinned: boolean;
	sourceLabel?: string;
	provenanceCount: number;
	color?: CanvasColor;
};

export type BoardImagePlan = {
	cards: BoardImageCard[];
	edges: CanvasEdge[];
	elements: CanvasElement[];
	minX: number;
	minY: number;
	logicalWidth: number;
	logicalHeight: number;
	pixelRatio: number;
	width: number;
	height: number;
	downscaled: boolean;
};

export type BoardImageInput = {
	noteIds: string[];
	notesById: ReadonlyMap<string, Note>;
	items: CanvasItem[];
	edges: CanvasEdge[];
	elements: CanvasElement[];
};

export type BoardImageDownloadInput = BoardImageInput & {
	filename: string;
	theme: BoardImageTheme;
};

export type BoardImageResult = {
	cardCount: number;
	width: number;
	height: number;
	downscaled: boolean;
};

function plainPreview(body: string): string {
	return body
		.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) =>
			String(label ?? target).trim()
		)
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/^\s*[-*+]\s+/gm, '• ')
		.replace(/^\s*\d+\.\s+/gm, '')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 420);
}

function imageScale(logicalWidth: number, logicalHeight: number): number {
	const desired = 2;
	const dimensionScale = Math.min(
		BOARD_IMAGE_MAX_DIMENSION / logicalWidth,
		BOARD_IMAGE_MAX_DIMENSION / logicalHeight
	);
	const pixelScale = Math.sqrt(BOARD_IMAGE_MAX_PIXELS / (logicalWidth * logicalHeight));
	return Math.max(Number.EPSILON, Math.min(desired, dimensionScale, pixelScale));
}

export function buildBoardImagePlan(input: BoardImageInput): BoardImagePlan | null {
	const wanted = new Set(input.noteIds);
	const notes = input.noteIds
		.map((id) => input.notesById.get(id))
		.filter((note): note is Note => Boolean(note && note.deletedAt == null));
	if (notes.length === 0) return null;

	const sourceItems = input.items.filter((item) => wanted.has(item.noteId));
	const itemByNote = new Map(sourceItems.map((item) => [item.noteId, item]));
	const placedRects = sourceItems.map((item) => ({
		x: item.x,
		y: item.y,
		w: item.w ?? DEFAULT_CARD.w,
		h: item.h ?? DEFAULT_CARD.h
	}));
	const placedMinX = placedRects.length > 0 ? Math.min(...placedRects.map((rect) => rect.x)) : 0;
	const placedMaxY =
		placedRects.length > 0 ? Math.max(...placedRects.map((rect) => rect.y + rect.h)) : -CARD_GAP;
	let syntheticIndex = 0;

	const cards: BoardImageCard[] = notes.map((note) => {
		const existing = itemByNote.get(note.id);
		const fallbackX =
			placedMinX + (syntheticIndex % SYNTHETIC_COLUMNS) * (DEFAULT_CARD.w + CARD_GAP);
		const fallbackY =
			placedMaxY +
			CARD_GAP * 2 +
			Math.floor(syntheticIndex / SYNTHETIC_COLUMNS) * (DEFAULT_CARD.h + CARD_GAP);
		if (!existing) syntheticIndex += 1;
		return {
			itemId: existing?.id ?? `synthetic:${note.id}`,
			noteId: note.id,
			x: existing?.x ?? fallbackX,
			y: existing?.y ?? fallbackY,
			w: existing?.w ?? DEFAULT_CARD.w,
			h: existing?.h ?? DEFAULT_CARD.h,
			title: note.title.trim() || 'Untitled',
			preview: plainPreview(note.body),
			textAlign:
				note.textAlign === 'center' || note.textAlign === 'right' ? note.textAlign : 'left',
			pinned: note.pinned === 1,
			sourceLabel:
				note.source?.kind === 'pdf'
					? `${note.source.title} · p. ${note.source.page}`
					: note.source?.kind === 'docx' ||
						  note.source?.kind === 'image' ||
						  note.source?.kind === 'url' ||
						  note.source?.kind === 'html' ||
						  note.source?.kind === 'table'
						? note.source.title
						: undefined,
			provenanceCount: note.mashedFrom?.length ?? 0,
			color: existing?.color
		};
	});
	const cardItemIds = new Set(cards.map((card) => card.itemId));
	const edges = input.edges.filter(
		(edge) => cardItemIds.has(edge.fromItemId) && cardItemIds.has(edge.toItemId)
	);
	const wholePlacedDesk = input.items.every((item) => cardItemIds.has(item.id));
	const elements = input.elements
		.filter((element) => {
			const boundIds = canvasElementItemIds(element);
			return boundIds.length === 0
				? wholePlacedDesk
				: boundIds.every((itemId) => cardItemIds.has(itemId));
		})
		.map(cloneCanvasElement);
	const rects = new Map(cards.map((card) => [card.itemId, card]));
	const elementPoints = elements.flatMap((element) => {
		if (element.kind !== 'arrow') return [];
		const path = canvasArrowPath(element, rects);
		return path ? [path.start, path.end, path.c1, path.c2] : [];
	});
	const minCardX = Math.min(
		...cards.map((card) => card.x),
		...elementPoints.map((point) => point.x)
	);
	const minCardY = Math.min(
		...cards.map((card) => card.y),
		...elementPoints.map((point) => point.y)
	);
	const maxCardX = Math.max(
		...cards.map((card) => card.x + card.w),
		...elementPoints.map((point) => point.x)
	);
	const maxCardY = Math.max(
		...cards.map((card) => card.y + card.h),
		...elementPoints.map((point) => point.y)
	);
	const minX = minCardX - BOARD_PADDING;
	const minY = minCardY - BOARD_PADDING;
	const logicalWidth = Math.max(1, maxCardX - minCardX + BOARD_PADDING * 2);
	const logicalHeight = Math.max(1, maxCardY - minCardY + BOARD_PADDING * 2);
	const pixelRatio = imageScale(logicalWidth, logicalHeight);

	return {
		cards,
		edges,
		elements,
		minX,
		minY,
		logicalWidth,
		logicalHeight,
		pixelRatio,
		width: Math.max(1, Math.round(logicalWidth * pixelRatio)),
		height: Math.max(1, Math.round(logicalHeight * pixelRatio)),
		downscaled: pixelRatio < 1
	};
}

const palettes = {
	dark: {
		board: '#141210',
		dot: 'rgba(180, 160, 130, 0.18)',
		card: '#2a241c',
		ink: '#efe6d8',
		muted: '#a89a88',
		edge: 'rgba(240, 230, 210, 0.18)',
		accent: '#8fbf6e',
		shadow: 'rgba(0, 0, 0, 0.34)'
	},
	light: {
		board: '#e4d8c4',
		dot: 'rgba(90, 70, 40, 0.22)',
		card: '#faf6ee',
		ink: '#2c2418',
		muted: '#6b5e4e',
		edge: 'rgba(80, 60, 30, 0.2)',
		accent: '#4a7538',
		shadow: 'rgba(70, 48, 25, 0.18)'
	}
} as const;

function roundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number
) {
	const r = Math.min(radius, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function truncateLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let value = text;
	while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth)
		value = value.slice(0, -1);
	return `${value}…`;
}

function wrappedLines(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	maxLines: number
): string[] {
	if (!text) return [];
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (ctx.measureText(candidate).width <= maxWidth) {
			line = candidate;
			continue;
		}
		if (line) lines.push(line);
		line = word;
		if (lines.length === maxLines) break;
	}
	if (lines.length < maxLines && line) lines.push(line);
	if (lines.length === maxLines && words.length > 0) {
		lines[maxLines - 1] = truncateLine(ctx, lines[maxLines - 1], maxWidth);
	}
	return lines.map((value) => truncateLine(ctx, value, maxWidth));
}

function drawArrow(
	ctx: CanvasRenderingContext2D,
	from: BoardImageCard,
	to: BoardImageCard,
	accent: string
) {
	const startX = from.x + from.w;
	const startY = from.y + from.h / 2;
	const endX = to.x;
	const endY = to.y + to.h / 2;
	const bend = Math.max(36, Math.abs(endX - startX) * 0.45);
	ctx.save();
	ctx.strokeStyle = accent;
	ctx.fillStyle = accent;
	ctx.globalAlpha = 0.9;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(startX, startY);
	ctx.bezierCurveTo(startX + bend, startY, endX - bend, endY, endX, endY);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(endX, endY);
	ctx.lineTo(endX - 9, endY - 5);
	ctx.lineTo(endX - 9, endY + 5);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

function colorAccent(color: CanvasColor | undefined, fallback: string): string {
	switch (color) {
		case 'amber':
			return '#d9a441';
		case 'blue':
			return '#5c9ed8';
		case 'rose':
			return '#d8798f';
		case 'violet':
			return '#9b83d6';
		case 'slate':
			return '#87939d';
		default:
			return fallback;
	}
}

function drawVisualArrow(
	ctx: CanvasRenderingContext2D,
	element: Extract<CanvasElement, { kind: 'arrow' }>,
	cards: ReadonlyMap<string, BoardImageCard>,
	fallbackAccent: string,
	labelInk: string,
	labelBackground: string
) {
	const path = canvasArrowPath(element, cards);
	if (!path) return;
	const accent = colorAccent(element.color, fallbackAccent);
	ctx.save();
	ctx.strokeStyle = accent;
	ctx.fillStyle = accent;
	ctx.globalAlpha = 0.9;
	ctx.lineWidth = 2.25;
	ctx.lineCap = 'round';
	if (element.stroke === 'dashed') ctx.setLineDash([8, 7]);
	ctx.beginPath();
	ctx.moveTo(path.start.x, path.start.y);
	ctx.bezierCurveTo(path.c1.x, path.c1.y, path.c2.x, path.c2.y, path.end.x, path.end.y);
	ctx.stroke();
	ctx.setLineDash([]);
	const angle = Math.atan2(path.end.y - path.c2.y, path.end.x - path.c2.x);
	ctx.beginPath();
	ctx.moveTo(path.end.x, path.end.y);
	ctx.lineTo(
		path.end.x - 10 * Math.cos(angle - Math.PI / 6),
		path.end.y - 10 * Math.sin(angle - Math.PI / 6)
	);
	ctx.lineTo(
		path.end.x - 10 * Math.cos(angle + Math.PI / 6),
		path.end.y - 10 * Math.sin(angle + Math.PI / 6)
	);
	ctx.closePath();
	ctx.fill();
	if (element.label?.trim()) {
		const label = element.label.trim().slice(0, 80);
		ctx.globalAlpha = 1;
		ctx.font = '600 10px "IBM Plex Sans", system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const width = Math.min(180, ctx.measureText(label).width + 14);
		roundedRect(ctx, path.midX - width / 2, path.midY - 10, width, 20, 10);
		ctx.fillStyle = labelBackground;
		ctx.fill();
		ctx.fillStyle = labelInk;
		ctx.fillText(truncateLine(ctx, label, width - 12), path.midX, path.midY);
	}
	ctx.restore();
}

export async function downloadBoardImage(
	input: BoardImageDownloadInput
): Promise<BoardImageResult> {
	const plan = buildBoardImagePlan(input);
	if (!plan) throw new Error('No cards are available for board image export');
	if (typeof document === 'undefined') throw new Error('Board image export requires a browser');
	await document.fonts?.ready;

	const canvas = document.createElement('canvas');
	canvas.width = plan.width;
	canvas.height = plan.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas rendering is unavailable');
	const palette = palettes[input.theme];
	ctx.scale(plan.pixelRatio, plan.pixelRatio);
	ctx.translate(-plan.minX, -plan.minY);
	ctx.fillStyle = palette.board;
	ctx.fillRect(plan.minX, plan.minY, plan.logicalWidth, plan.logicalHeight);

	ctx.fillStyle = palette.dot;
	for (let x = Math.floor(plan.minX / 24) * 24; x <= plan.minX + plan.logicalWidth; x += 24) {
		for (let y = Math.floor(plan.minY / 24) * 24; y <= plan.minY + plan.logicalHeight; y += 24) {
			ctx.fillRect(x, y, 1.25, 1.25);
		}
	}

	const cardByItemId = new Map(plan.cards.map((card) => [card.itemId, card]));
	for (const edge of plan.edges) {
		const from = cardByItemId.get(edge.fromItemId);
		const to = cardByItemId.get(edge.toItemId);
		if (from && to) drawArrow(ctx, from, to, palette.accent);
	}
	for (const element of plan.elements) {
		if (element.kind === 'arrow') {
			drawVisualArrow(ctx, element, cardByItemId, palette.accent, palette.ink, palette.card);
		}
	}

	for (const card of plan.cards) {
		const cardAccent = colorAccent(card.color, palette.accent);
		ctx.save();
		ctx.shadowColor = palette.shadow;
		ctx.shadowBlur = 18;
		ctx.shadowOffsetY = 7;
		roundedRect(ctx, card.x, card.y, card.w, card.h, 10);
		ctx.fillStyle = palette.card;
		ctx.fill();
		ctx.shadowColor = 'transparent';
		ctx.strokeStyle = card.color ? cardAccent : palette.edge;
		ctx.globalAlpha = card.color ? 0.82 : 1;
		ctx.lineWidth = card.color ? 1.6 : 1;
		ctx.stroke();
		ctx.globalAlpha = 1;

		ctx.beginPath();
		ctx.moveTo(card.x, card.y + 34);
		ctx.lineTo(card.x + card.w, card.y + 34);
		ctx.stroke();
		ctx.textBaseline = 'top';
		ctx.textAlign = 'left';
		ctx.fillStyle = palette.ink;
		ctx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
		const titlePrefix = card.pinned ? '● ' : '';
		ctx.fillText(
			truncateLine(ctx, `${titlePrefix}${card.title}`, card.w - 22),
			card.x + 11,
			card.y + 10
		);

		ctx.fillStyle = palette.muted;
		ctx.font = '400 11px "IBM Plex Sans", system-ui, sans-serif';
		ctx.textAlign = card.textAlign;
		const textX =
			card.textAlign === 'center'
				? card.x + card.w / 2
				: card.textAlign === 'right'
					? card.x + card.w - 11
					: card.x + 11;
		const footerRows = Number(Boolean(card.sourceLabel)) + Number(card.provenanceCount > 0);
		const maxLines = Math.max(1, Math.floor((card.h - 52 - footerRows * 14) / 15));
		const lines = wrappedLines(ctx, card.preview, card.w - 22, maxLines);
		lines.forEach((line, index) => ctx.fillText(line, textX, card.y + 45 + index * 15));

		ctx.textAlign = 'left';
		ctx.fillStyle = cardAccent;
		ctx.font = '500 9px "IBM Plex Sans", system-ui, sans-serif';
		let footerY = card.y + card.h - 15;
		if (card.provenanceCount > 0) {
			ctx.fillText(
				`Made from ${card.provenanceCount} source${card.provenanceCount === 1 ? '' : 's'}`,
				card.x + 11,
				footerY
			);
			footerY -= 14;
		}
		if (card.sourceLabel)
			ctx.fillText(truncateLine(ctx, card.sourceLabel, card.w - 22), card.x + 11, footerY);
		ctx.restore();
	}

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(value) => (value ? resolve(value) : reject(new Error('Could not encode the board image'))),
			'image/png'
		);
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = input.filename.endsWith('.png') ? input.filename : `${input.filename}.png`;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);

	return {
		cardCount: plan.cards.length,
		width: plan.width,
		height: plan.height,
		downscaled: plan.downscaled
	};
}

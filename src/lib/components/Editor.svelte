<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorView, Decoration, ViewPlugin, WidgetType, ViewUpdate } from '@codemirror/view';
	import { RangeSet } from '@codemirror/state';
	import { markdown } from '@codemirror/lang-markdown';
	import { keymap } from '@codemirror/view';
	import { defaultKeymap } from '@codemirror/commands';
	import { basicSetup } from 'codemirror';

	let { 
		value = $bindable(''), 
		onChange, 
		noteId = '',
		onWikilinkClick 
	} = $props<{
		value?: string;
		onChange?: (val: string) => void;
		noteId?: string;
		onWikilinkClick?: (title: string) => void;
	}>();

	let container: HTMLDivElement;
	let view: EditorView | null = null;
	let lastNoteId = '';

	// Wikilink regex: [[Title]] or [[Title|Alias]]
	const wikilinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

	// Custom widget for wikilink pill (clickable, styled)
	class WikilinkWidget extends WidgetType {
		title: string;
		alias?: string;
		onClick?: (title: string) => void;

		constructor(title: string, alias?: string, onClick?: (title: string) => void) {
			super();
			this.title = title;
			this.alias = alias;
			this.onClick = onClick;
		}

		toDOM() {
			const span = document.createElement('span');
			span.className = 'cm-wikilink';
			span.textContent = this.alias || this.title;
			span.title = `Jump to: ${this.title}`;
			span.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.onClick?.(this.title);
			};
			return span;
		}

		eq(other: WikilinkWidget) {
			return this.title === other.title && this.alias === other.alias;
		}
	}

	// ViewPlugin for dynamic wikilink decorations
	function wikilinkPlugin(onClick?: (title: string) => void) {
		return ViewPlugin.fromClass(class {
			decorations: RangeSet<Decoration> = RangeSet.empty;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView) {
				const builder = [];
				const doc = view.state.doc.toString();

				let match;
				while ((match = wikilinkRegex.exec(doc)) !== null) {
					const start = match.index;
					const end = start + match[0].length;
					const title = match[1].trim();
					const alias = match[2] ? match[2].trim() : undefined;

					const widget = new WikilinkWidget(title, alias, onClick);
					const deco = Decoration.replace({
						widget,
						side: -1,
					});

					builder.push(deco.range(start, end));
				}

				return RangeSet.of(builder);
			}
		}, {
			decorations: (v) => v.decorations
		});
	}

	// Basic dark theme matching app
	const darkTheme = EditorView.theme({
		'&': {
			color: '#e4e4e7',
			backgroundColor: '#09090b',
		},
		'.cm-content': {
			caretColor: '#a1a1aa',
			maxWidth: '48rem',
			margin: '0 auto',
			padding: '2rem 1rem',
			lineHeight: '1.68',
			fontSize: '1.0625rem',
			letterSpacing: '0.01em',
		},
		'.cm-gutters': {
			backgroundColor: '#09090b',
			color: '#52525b',
			border: 'none',
		},
		'.cm-wikilink': {
			backgroundColor: '#27272a',
			color: '#93c5fd',
			padding: '1px 5px',
			borderRadius: '3px',
			cursor: 'pointer',
			fontWeight: '500',
			border: '1px solid #3f4f6b',
			transition: 'border-color 120ms ease, background-color 120ms ease',
		},
		'.cm-wikilink:hover': {
			backgroundColor: '#3f4f6b',
			borderColor: '#64748b',
			color: '#e0f0fe',
		},
	});

	function createEditor() {
		if (view) view.destroy();

		const extensions = [
			basicSetup,
			markdown(),
			EditorView.lineWrapping,
			darkTheme,
			EditorView.updateListener.of((update: any) => {
				if (update.docChanged) {
					// Only emit outbound — parent owns the value prop.
					onChange?.(update.state.doc.toString());
				}
			}),
			keymap.of(defaultKeymap),
			wikilinkPlugin(onWikilinkClick),
		];

		view = new EditorView({
			doc: value,
			parent: container,
			extensions,
		});
	}

	$effect(() => {
		// Only react to note switches. While the same note is open, the editor
		// owns its document; typing flows out via onChange to the parent.
		if (noteId !== lastNoteId) {
			lastNoteId = noteId;
			if (view) {
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: value ?? '' },
					selection: { anchor: 0 },
				});
			} else {
				createEditor();
			}
		}
	});

	onMount(() => {
		createEditor();
	});

	onDestroy(() => {
		view?.destroy();
	});
</script>

<div bind:this={container} class="h-full w-full overflow-auto bg-zinc-950 text-[15px] font-mono"></div>

<style>
	:global(.cm-editor) {
		height: 100%;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	}
	/* .cm-content padding is now controlled by the darkTheme in EditorView.theme for consistent sanctuary layout */
	:global(.cm-wikilink) {
		display: inline-block;
	}
</style>


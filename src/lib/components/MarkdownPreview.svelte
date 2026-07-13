<script lang="ts">
	import type { MarkdownNode } from '$lib/markdown-nodes';

	interface Props {
		nodes: MarkdownNode[];
		onWikilink?: (target: string) => void;
	}

	let { nodes, onWikilink }: Props = $props();

	function openWikilink(event: MouseEvent, target: string) {
		event.preventDefault();
		event.stopPropagation();
		onWikilink?.(target);
	}
</script>

{#snippet renderNodes(items: MarkdownNode[])}
	{#each items as node (node)}
		{#if node.type === 'text'}
			{node.text}
		{:else if node.type === 'wikilink'}
			<button
				type="button"
				class="mash-wikilink"
				data-wikilink={node.target}
				onclick={(event) => openWikilink(event, node.target)}>{node.label}</button
			>
		{:else if node.type === 'paragraph'}
			<p>{@render renderNodes(node.children)}</p>
		{:else if node.type === 'heading'}
			{#if node.depth === 1}
				<h1>{@render renderNodes(node.children)}</h1>
			{:else if node.depth === 2}
				<h2>{@render renderNodes(node.children)}</h2>
			{:else if node.depth === 3}
				<h3>{@render renderNodes(node.children)}</h3>
			{:else if node.depth === 4}
				<h4>{@render renderNodes(node.children)}</h4>
			{:else if node.depth === 5}
				<h5>{@render renderNodes(node.children)}</h5>
			{:else}
				<h6>{@render renderNodes(node.children)}</h6>
			{/if}
		{:else if node.type === 'strong'}
			<strong>{@render renderNodes(node.children)}</strong>
		{:else if node.type === 'emphasis'}
			<em>{@render renderNodes(node.children)}</em>
		{:else if node.type === 'delete'}
			<del>{@render renderNodes(node.children)}</del>
		{:else if node.type === 'link'}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- User-authored links may be external or relative. -->
			<a href={node.href} title={node.title} rel="noopener noreferrer" target="_blank"
				>{@render renderNodes(node.children)}</a
			>
		{:else if node.type === 'image'}
			<img src={node.src} alt={node.alt} title={node.title} loading="lazy" />
		{:else if node.type === 'code'}
			<code>{node.text}</code>
		{:else if node.type === 'code-block'}
			<pre><code class={node.language ? `language-${node.language}` : undefined}>{node.text}</code
				></pre>
		{:else if node.type === 'break'}
			<br />
		{:else if node.type === 'rule'}
			<hr />
		{:else if node.type === 'blockquote'}
			<blockquote>{@render renderNodes(node.children)}</blockquote>
		{:else if node.type === 'list'}
			{#if node.ordered}
				<ol start={node.start}>
					{#each node.items as item (item)}
						<li>
							{#if item.task}<input type="checkbox" checked={item.checked} disabled />{/if}
							{@render renderNodes(item.children)}
						</li>
					{/each}
				</ol>
			{:else}
				<ul>
					{#each node.items as item (item)}
						<li>
							{#if item.task}<input type="checkbox" checked={item.checked} disabled />{/if}
							{@render renderNodes(item.children)}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if node.type === 'table'}
			<table>
				<thead>
					<tr>
						{#each node.header as cell (cell)}<th>{@render renderNodes(cell)}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each node.rows as row (row)}
						<tr
							>{#each row as cell (cell)}<td>{@render renderNodes(cell)}</td>{/each}</tr
						>
					{/each}
				</tbody>
			</table>
		{/if}
	{/each}
{/snippet}

{@render renderNodes(nodes)}

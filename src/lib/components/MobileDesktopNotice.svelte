<svelte:head>
	<title>Mash · desktop workspace</title>
	<meta name="description" content="Mash is currently optimized for laptop and desktop use." />
</svelte:head>

<main class="mash-mobile-notice" data-testid="mobile-desktop-notice">
	<section class="mash-mobile-notice-card" aria-labelledby="mash-mobile-notice-title">
		<div class="mash-mobile-notice-glow" aria-hidden="true"></div>
		<img
			data-testid="mobile-settings-mascot"
			src="/icons/mash-settings-mascot.png"
			srcset="/icons/mash-settings-mascot.png 1x, /icons/mash-settings-mascot@2x.png 2x"
			alt=""
			width="192"
			height="240"
			class="mash-mobile-notice-mascot"
			draggable="false"
		/>

		<p class="mash-mobile-notice-kicker">A little more counter space, please</p>
		<h1 id="mash-mobile-notice-title" class="mash-display">
			Mash is currently optimized for desktop use.
		</h1>
		<p class="mash-type-body mash-mobile-notice-copy">
			Open Mash on a laptop or desktop for the full canvas experience.
		</p>
		<p class="mash-type-caption mash-mobile-notice-footnote">
			Mobile support is still under construction.
		</p>
	</section>
</main>

<style>
	.mash-mobile-notice {
		position: relative;
		display: grid;
		min-height: 100vh;
		min-height: 100svh;
		place-items: center;
		overflow: hidden;
		padding: max(1.25rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right))
			max(1.25rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
		background-color: var(--mash-board);
		background-image: radial-gradient(
			circle at center,
			color-mix(in srgb, var(--mash-tray-edge) 70%, transparent) 1px,
			transparent 1.5px
		);
		background-size: 30px 30px;
		color: var(--mash-ink);
	}

	.mash-mobile-notice-card {
		isolation: isolate;
		position: relative;
		display: flex;
		width: min(100%, 31rem);
		flex-direction: column;
		align-items: center;
		overflow: hidden;
		border: 1px solid var(--mash-tray-edge);
		border-radius: 2rem;
		padding: clamp(1.75rem, 7vw, 3rem) clamp(1.4rem, 7vw, 2.75rem);
		background: color-mix(in srgb, var(--mash-panel) 96%, transparent);
		box-shadow:
			0 1.5rem 4rem color-mix(in srgb, #000 42%, transparent),
			inset 0 1px color-mix(in srgb, var(--mash-ink) 8%, transparent);
		text-align: center;
	}

	.mash-mobile-notice-glow {
		position: absolute;
		z-index: -1;
		top: -7rem;
		left: 50%;
		width: 20rem;
		height: 20rem;
		transform: translateX(-50%);
		border-radius: 999px;
		background: color-mix(in srgb, var(--mash-accent) 17%, transparent);
		filter: blur(3rem);
	}

	.mash-mobile-notice-mascot {
		width: clamp(7.5rem, 36vw, 11rem);
		height: auto;
		filter: drop-shadow(0 0.85rem 1rem color-mix(in srgb, #000 35%, transparent));
		user-select: none;
	}

	.mash-mobile-notice-kicker {
		margin-top: 1.15rem;
		color: var(--mash-accent-bright);
		font-family: var(--mash-font-display);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1.35;
		text-transform: uppercase;
	}

	h1 {
		max-width: 24rem;
		margin-top: 0.65rem;
		font-size: clamp(1.65rem, 7vw, 2.35rem);
		font-weight: 650;
		line-height: 1.08;
		text-wrap: balance;
	}

	.mash-mobile-notice-copy {
		max-width: 22rem;
		margin-top: 1rem;
		color: var(--mash-ink-muted);
		font-size: clamp(1rem, 4.5vw, 1.12rem);
		line-height: 1.55;
		text-wrap: balance;
	}

	.mash-mobile-notice-footnote {
		margin-top: 1.25rem;
		border-top: 1px solid color-mix(in srgb, var(--mash-tray-edge) 75%, transparent);
		padding-top: 1rem;
		color: color-mix(in srgb, var(--mash-ink-muted) 75%, transparent);
	}

	@media (max-height: 580px) {
		.mash-mobile-notice-card {
			width: min(100%, 40rem);
			padding-block: 1rem;
		}

		.mash-mobile-notice-mascot {
			width: 5.5rem;
		}

		.mash-mobile-notice-kicker {
			margin-top: 0.45rem;
		}

		h1 {
			margin-top: 0.35rem;
			font-size: 1.55rem;
		}

		.mash-mobile-notice-copy {
			margin-top: 0.55rem;
		}

		.mash-mobile-notice-footnote {
			margin-top: 0.65rem;
			padding-top: 0.65rem;
		}
	}
</style>

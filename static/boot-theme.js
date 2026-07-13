(function () {
	try {
		var theme = localStorage.getItem('mash-theme');
		if (theme !== 'light' && theme !== 'dark') theme = 'dark';
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', theme === 'light' ? '#efe6d8' : '#0e0c0a');
	} catch {
		// Storage can be unavailable in hardened/private browsing contexts.
	}
	try {
		var textSize = localStorage.getItem('mash-text-size');
		if (textSize !== 'compact' && textSize !== 'comfortable' && textSize !== 'large') {
			textSize = 'comfortable';
		}
		document.documentElement.dataset.textSize = textSize;
	} catch {
		document.documentElement.dataset.textSize = 'comfortable';
	}
	try {
		var suites = {
			kitchen: {
				ui: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
				display: "'Fraunces', ui-serif, Georgia, serif"
			},
			editor: {
				ui: "'Source Sans 3', ui-sans-serif, system-ui, sans-serif",
				display: "'Source Serif 4', ui-serif, Georgia, serif"
			},
			workshop: {
				ui: "'Inter', ui-sans-serif, system-ui, sans-serif",
				display: "'Newsreader', ui-serif, Georgia, serif"
			},
			atelier: {
				ui: "'Nunito Sans', ui-sans-serif, system-ui, sans-serif",
				display: "'Literata', ui-serif, Georgia, serif"
			},
			napkin: {
				ui: "'Excalifont', 'Segoe Print', 'Comic Sans MS', cursive",
				display: "'Excalifont', 'Segoe Print', 'Comic Sans MS', cursive"
			},
			terminal: {
				ui: "'IBM Plex Mono', ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace",
				display:
					"'IBM Plex Mono', ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace"
			}
		};
		var typography = localStorage.getItem('mash-typography');
		if (!Object.prototype.hasOwnProperty.call(suites, typography)) typography = 'kitchen';
		var suite = suites[typography];
		document.documentElement.dataset.typography = typography;
		document.documentElement.style.setProperty('--mash-font-ui', suite.ui);
		document.documentElement.style.setProperty('--mash-font-display', suite.display);
	} catch {
		// The CSS defaults remain usable if storage or DOM access fails.
	}
})();

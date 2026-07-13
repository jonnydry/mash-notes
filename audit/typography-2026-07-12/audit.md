# Mash typography and readability audit

## Scope

Project-wide type-size inventory plus live inspection of all six typography suites in the Settings panel and the populated canvas. Dark theme, desktop viewport.

## Evidence

1. `01-kitchen-settings.png` — Kitchen suite and Settings density
2. `02-editor-settings.png` — Editor suite
3. `03-workshop-settings.png` — Workshop suite
4. `04-atelier-settings.png` — Atelier suite
5. `05-napkin-settings.png` — Napkin suite
6. `06-terminal-settings.png` — Terminal suite
7. `07-canvas-cards.png` — card titles, body previews, badges, board chrome

## Static inventory

- 255 font-size references were found across Svelte/CSS source.
- 111 declarations are below 12px:
  - 8px: 3
  - 9px: 20
  - 10px: 52
  - 10.5px: 1
  - 11px: 35
- The inspected Settings screen alone contained 105 visible leaf-text elements at 11px or below: 59 at 10px and 46 at 11px.
- Another 44 usages are Tailwind `text-xs` (12px), so the interface is strongly concentrated in a 10–12px band.

## Surface findings

### Settings and peel chrome — needs improvement

The 12px primary labels are workable. The 10px section headings, subtitles, descriptions, and suite hints are too small for sustained reading, especially with muted color. Settings buttons at 11px are also smaller than they need to be.

### Canvas cards — mixed

Card titles are readable, aided by board zoom. Collapsed preview text is 11px, scope badges are 8px, and provenance/source lines are 9px. Zoom can mask the issue visually but does not provide a stable baseline across viewport scales.

### Board and dock chrome — compact but fragile

Board chips and the desk title chip are 10px. They are short labels, so compact sizing is defensible, but 11px should be the minimum for controls. The dock relies mostly on icons and is less affected.

### Search, trays, and metadata — needs improvement

Several search-result and peel metadata rows are 9px. These carry timestamps, counts, sources, and context rather than purely decorative information, so they should be 11–12px.

### Editors and document readers — generally healthy

Sticky editor body text is 13px and would benefit from 14px as the comfortable default. DOCX body text is 15.5px and already appropriate. Reader chrome largely sits at 12–13px and is substantially healthier than the canvas metadata.

## Suite findings

- **Kitchen:** Balanced at 12px+, but the 10px microcopy remains visibly small.
- **Editor:** Source Sans has a generous x-height and is the most readable suite at the current scale.
- **Workshop:** Inter is clear and compact; Newsreader samples remain readable.
- **Atelier:** Nunito Sans is friendly and open; Literata benefits from slightly more line height in longer text.
- **Napkin:** Most affected. Excalifont’s handwritten shapes and single real font weight make 9–10px labels look thin and cramped. It needs an optical bump rather than relying on `font-weight`.
- **Terminal:** Monospace text is legible but wide and visually smaller at 10px. It needs a modest optical bump and more line height for paragraphs.

## Recommended normalized scale

| Token | Comfortable default | Use |
|---|---:|---|
| Micro | 11px | badges and very short status labels only |
| Caption | 12px | hints, metadata, timestamps, secondary labels |
| Control | 13px | buttons, tabs, menus, card titles |
| UI body | 14px | settings explanations, tray rows, collapsed cards |
| Reading | 16px | document/editor body text |

No meaningful text should remain at 8–9px. Ten pixels should be reserved for nonessential keyboard glyphs or ornamental marks, not instructions or metadata.

## Text-size control recommendation

Add a three-option control under Appearance:

- **Compact:** 10 / 11 / 12 / 13 / 15px
- **Comfortable (default):** 11 / 12 / 13 / 14 / 16px
- **Large:** 12 / 13 / 14 / 16 / 18px

Implement it with semantic CSS tokens rather than global browser-style zoom. Root font-size scaling would also enlarge spacing and board geometry, while the goal is specifically readability. Napkin and Terminal should receive an additional internal optical adjustment independent of the user’s size choice.

## Recommended sequence

1. Replace 8–11px one-off values on Settings, cards, search, and tray metadata with semantic tokens.
2. Make Comfortable the default and preserve the current density as Compact.
3. Add the Settings selector and persist it locally beside the typography-suite preference.
4. Add Napkin/Terminal optical overrides and regression screenshots at desktop and mobile widths.

## Accessibility limits

This audit inspected rendered screenshots, computed sizes, source declarations, and font metrics. It does not claim full WCAG conformance. Browser zoom at 200%, OS text scaling, screen-reader announcements, and mobile reflow still need dedicated verification after implementation.

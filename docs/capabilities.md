# Mash capabilities

Mash is a temporary local workbench. Its feature set is organized around getting material in, shaping a set, and taking a portable result away.

## Intake

### Paste and type

- Paste plain text as one card, one card per non-empty line, or one card per paragraph.
- Paste up to 200 text cards in one action; excess source text is bounded before parsing.
- Paste up to 50 HTTP(S) URLs as local source cards.
- Paste clipboard images, with accompanying text retained as the card caption.
- Type directly on an empty desk or create a full Markdown note.

### Files and documents

- Drop or pick plain-text and Markdown files.
- Open PDFs up to 50 MiB and 5,000 pages in the local reader, then clip selected text.
- Open Word `.docx` files up to 8 MB using bounded archive and image extraction.
- Open HTML files up to 5 MiB after active content and unsafe resource URLs are removed.
- Drop or paste PNG, JPEG, WebP, and GIF images up to 20 MiB each, with bounded dimensions and decoded pixels.
- Import up to 50 images in one action.
- Extract a still or up to 36 evenly sampled frames from an animated GIF.
- Import up to 5,000 Markdown files from an Obsidian vault or Bear export, subject to per-file and total-size limits.

## Workbench

- Free placement, snap placement, pan, zoom, fit, and layout undo.
- Spatial selection and contextual actions.
- Mash and Unmash with source lineage.
- Split, stack, spread, pack, sort, shuffle, and deduplicate operators.
- Sequence links, ordinary links, backlinks, tags, and folders.
- Bowls for explicit named groups.
- Reversible operation receipts showing inputs, outputs, and available undo actions.
- Scratch ingredients that can be promoted to kept local work at any time.
- Markdown editing and safe preview.
- Search and a keyboard-driven command palette.

## Finish and portability

Choose selected cards, active operation results, or the whole desk, then:

- copy Markdown;
- download a Markdown file;
- print or save as PDF;
- export a bounded PNG board image;
- export a MASH bundle containing the desk and result history.

Finish separately controls what remains on the device:

- keep the takeaway;
- keep the entire desk;
- leave it as scratch until expiration;
- clear it into 7-day recovery.

## Local lifecycle

- New desks are scratch desks.
- The default scratch retention period is 14 days of meaningful inactivity.
- Viewing, panning, searching, and exporting do not extend the deadline.
- Editing, importing, moving, transforming, or deleting content does extend it.
- Kept desks and kept results do not expire automatically.
- Recently cleared desks can be restored for 7 days.

## Progressive web app

- Static deployment with no application server.
- Installable manifest and service worker.
- Core application assets cached for repeat offline use.
- Heavy readers, export tools, dialogs, and alternate fonts loaded only when needed.
- Dark and light themes, typography choices, and compact/comfortable/large text settings.
- Responsive desktop and coarse-pointer layouts.

## Deliberate non-features

Mash currently has no:

- user accounts;
- application cloud database;
- automatic background synchronization;
- real-time collaboration;
- remote URL scraping;
- AI service dependency;
- guarantee that browser-local data survives browser-profile or device deletion.

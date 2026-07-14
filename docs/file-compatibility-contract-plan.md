# Mash file compatibility contract plan

Status: Implemented
Target: v0.3 Trust Release
Owner: Product and engineering
Updated: 2026-07-13

Implementation landed as the typed format registry and lightweight intake projection, retained
version 1–6 fixtures, contract/documentation tests, and bounded preview-first CSV/TSV intake.

## Outcome

Every supported file type should have one accurate, testable promise covering:

- how it enters Mash;
- what Mash preserves, extracts, transforms, or intentionally drops;
- its size and complexity limits;
- its security boundary;
- what can be exported again;
- whether it supports content or full-workspace round trips.

The contract should drive interface labels, file pickers, unsupported-file messages, documentation,
fixtures, and release checks so those surfaces cannot quietly drift apart.

## Why this matters now

Mash supports more than its visible drop guidance and current file-format documentation describe.
The implementation includes Markdown and text, notes JSON, versioned MASH JSON, PDF, DOCX, HTML,
PNG, JPEG, WebP, GIF, pasted URLs, Markdown/PDF/PNG outputs, and document clipping behavior. Limits
and file-accept strings are spread across readers, intake helpers, the page, and components.

That creates two product risks:

1. People do not discover useful formats that already work.
2. Documentation can promise preservation that the actual serialized schema does not provide.

The first goal is contract accuracy and shared enforcement. CSV/TSV is the first new format after
that foundation lands.

## Contract vocabulary

Use these behavior classes consistently:

| Class                | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| **Import**           | Creates notes/cards from the file's content                            |
| **Open and clip**    | Opens a local reader; only user-selected excerpts become Mash cards    |
| **Visual intake**    | Creates visual cards backed by local image blobs                       |
| **Content handoff**  | Exports useful text or a visual result but not the complete desk model |
| **Desk bundle**      | Preserves one active working desk and its promised local model         |
| **Workspace backup** | Preserves all user work covered by the backup contract                 |

Avoid using “round trip” for PDF, DOCX, or HTML clipping. Mash extracts useful material from those
formats; it does not reconstruct the source document.

## Preservation levels

Define three explicit preservation levels:

### Level 0 — extraction only

The source file remains external. Mash preserves selected text or pixels plus compact provenance.
Examples: PDF, DOCX, and HTML readers.

### Level 1 — content round trip

Titles and bodies survive an export/import cycle. Other fields are preserved only when the row in
the matrix says so. Examples: notes JSON and Markdown vault import/export.

### Level 2 — workspace round trip

The artifact preserves the declared desk or workspace model: lifecycle, notes, canvas layout,
relationships, assets, and operation history. Examples: MASH desk bundles and workspace backups.

## Canonical compatibility matrix

Replace the current prose-only format list with a table that includes at least these columns:

| Field             | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| Format            | User-facing name                                                |
| Extensions / MIME | Accepted identification                                         |
| Entry points      | Drop, paste, picker, Settings, Finish, palette                  |
| Behavior          | Import, open and clip, visual intake, or export                 |
| Maximums          | Bytes, rows, pages, pixels, files, entries, and generated cards |
| Preserved         | Fields that survive                                             |
| Not preserved     | Intentional losses                                              |
| Output            | Available handoff formats                                       |
| Round-trip level  | 0, 1, or 2                                                      |
| Security notes    | Sanitization and rejection behavior                             |
| Test fixtures     | Valid, boundary, and hostile fixture IDs                        |

The published matrix must cover the following baseline.

### Current inputs

| Format                           | Current behavior to document                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `.md`, `.markdown`, `.txt`       | One note per file; Markdown vault import can preserve relative folder, supported front matter, hashtags, and wikilinks within documented caps |
| `.json` notes export             | Validated content import; safe IDs and bounded fields; does not restore the full desk                                                         |
| MASH bundle JSON v1–v5           | Validated versioned import with version-specific preservation                                                                                 |
| `.pdf`                           | Local reader; selected text and region clippings become cards with filename and page provenance                                               |
| `.docx`                          | Local sanitized reader; selected excerpts become cards with filename provenance                                                               |
| `.html`, `.htm`                  | Local sanitized reader; selected excerpts become cards; active content and remote fetches remain blocked                                      |
| `.png`, `.jpg`, `.jpeg`, `.webp` | Visual sticky; soft resize and pixel/byte limits; stored as local blob data                                                                   |
| `.gif`                           | User chooses a still or a bounded frame set; hostile or excessive frames are rejected                                                         |
| Pasted HTTP(S) URL               | Local link card; Mash does not fetch destination metadata                                                                                     |

### Current outputs

| Format                | Current behavior to document                                           |
| --------------------- | ---------------------------------------------------------------------- |
| Clipboard Markdown    | Chosen Finish scope; content handoff only                              |
| Downloaded Markdown   | Chosen Finish scope; content handoff only                              |
| Notes JSON            | Note collection fields covered by its schema; not full workspace state |
| Print / PDF           | Browser print pipeline; visual/text handoff, not source reconstruction |
| Board PNG             | Bounded canvas image of the chosen scope                               |
| MASH desk bundle      | Active-desk portability according to the emitted schema                |
| MASH workspace backup | Planned whole-workspace preservation contract                          |

## Single source of truth in code

Introduce a typed registry for user-facing file capabilities:

```ts
type FileFormatId =
	| 'markdown'
	| 'text'
	| 'notes-json'
	| 'mash-bundle'
	| 'pdf'
	| 'docx'
	| 'html'
	| 'png'
	| 'jpeg'
	| 'webp'
	| 'gif'
	| 'csv'
	| 'tsv';

interface FileFormatContract {
	id: FileFormatId;
	label: string;
	extensions: readonly string[];
	mimeTypes: readonly string[];
	entryPoints: readonly ('drop' | 'paste' | 'picker' | 'settings' | 'finish' | 'palette')[];
	behavior: 'import' | 'open-and-clip' | 'visual-intake' | 'content-export' | 'bundle';
	maxBytes?: number;
	preservationLevel: 0 | 1 | 2;
}
```

The registry should power:

- external-file classification;
- hidden input `accept` values;
- drop-zone format guidance;
- unsupported-file error copy;
- command palette and Settings labels where applicable;
- unit tests that enumerate supported formats.

Keep parser-specific complexity limits beside each parser, but export them through the registry or a
shared limit module. Remove duplicated PDF, DOCX, and HTML byte constants.

Documentation remains human-edited because preservation notes need nuance. Add a contract test that
asserts every registry format appears in the documentation matrix and every documented current
format maps to a registry entry.

## Preservation matrix

Add a second table to `docs/file-formats.md` that makes field-level guarantees explicit:

| Field                      | Markdown                                       | Notes JSON        | Desk bundle       | Workspace backup |
| -------------------------- | ---------------------------------------------- | ----------------- | ----------------- | ---------------- |
| Title and body             | Yes                                            | Yes               | Yes               | Yes              |
| Tags                       | Supported front matter / hashtags              | Yes               | Yes               | Yes              |
| Folder                     | Relative import path; export policy documented | Yes               | Yes               | Yes              |
| Source provenance          | Optional rendered text only                    | Yes when valid    | Yes               | Yes              |
| Pinned / kept state        | No                                             | Contract-specific | Contract-specific | Yes              |
| Canvas placement and size  | No                                             | No                | Yes               | Yes              |
| Edges and bowls            | No                                             | No                | Yes when emitted  | Yes              |
| Visual assets              | Referenced output only                         | Contract-specific | Yes when emitted  | Yes              |
| Scratch/recovery lifecycle | No                                             | No                | Contract-specific | Yes              |
| Operation history          | No                                             | Contract-specific | Yes when emitted  | Yes              |
| Deletion tombstones        | No                                             | No                | Yes when emitted  | Yes              |

Do not mark a cell `Yes` until a fixture proves the round trip.

## Fixture policy

Create a durable fixture tree instead of assembling all compatibility objects inline:

```text
fixtures/
  formats/
    markdown/
    json-notes/
    mash-bundles/v1/
    mash-bundles/v2/
    mash-bundles/v3/
    mash-bundles/v4/
    mash-bundles/v5/
    mash-bundles/v6/
    pdf/
    docx/
    html/
    images/
    gif/
    delimited/
```

Each supported input gets:

- a minimal valid fixture;
- a representative real-world fixture;
- an exact boundary fixture or generated boundary test;
- malformed input;
- oversized or excessive-complexity input;
- a hostile-content fixture where applicable.

Bundle fixtures are retained permanently for every version still listed as supported. They should
not be regenerated by the current exporter because that would hide backward-compatibility breaks.

## Round-trip verification

### Content round trips

For Markdown and notes JSON, start with a canonical note set containing:

- Unicode and emoji;
- headings, lists, tables, code blocks, and links;
- wikilinks and hashtags;
- duplicate titles;
- nested folders;
- long but valid fields;
- source provenance;
- an image reference where the format claims to support it.

Export, import into a clean database, and compare only the fields promised by the preservation
matrix. Intentional losses should be asserted, not ignored.

### Workspace round trips

For desk bundles and workspace backups, use a canonical workspace containing:

- a scratch desk, kept desk, and recovering desk;
- regular, linked, grouped, sequenced, image, and operation-result cards;
- canvas positions and sizes;
- edges and bowls;
- a soft-deleted note and tombstone;
- an operation that has been reverted;
- at least one visual blob.

Export, clear the database, import, and compare the promised model after normalization. Then open the
restored workspace in the browser test and verify the major user-visible relationships.

## Security contract

Every importer follows the same order:

1. Identify by a bounded extension/MIME policy; never trust MIME alone.
2. Check compressed or raw byte size before expensive parsing when possible.
3. Bound counts, nesting, decoded pixels, expanded archive bytes, and generated cards.
4. Parse into plain data without executing active content.
5. Normalize strings, IDs, coordinates, URLs, and arrays.
6. Validate references before writes.
7. Perform persistence only after the complete payload is accepted.
8. Report a safe, specific error without echoing large or active file contents.

Hostile fixtures should cover:

- invalid JSON and deep/excessive structures;
- DOCX archive bombs and excessive embedded images;
- HTML scripts, event handlers, remote resources, and unsafe URLs;
- image and GIF pixel/frame bombs;
- malformed PDF and excessive page counts;
- CSV formula-looking cells, quoted delimiters, multiline cells, and oversized rows;
- bundle reference corruption and integrity mismatch.

## CSV and TSV intake

CSV/TSV is the first new format after the contract foundation because it supports quick list and
idea manipulation without turning Mash into a spreadsheet.

### Product scope

Support UTF-8 `.csv` and `.tsv` files through drop and a visible `Open table…` action. Do not add
spreadsheet editing, formulas, sorting controls, or CSV export in this slice.

After parsing, show a lightweight preview with:

- detected delimiter;
- header row;
- row and column counts;
- a short sample;
- output choice.

Output choices:

1. `One card per row` — default for 200 rows or fewer.
2. `One Markdown table card` — default for larger files that fit the note-body limit.

For row cards, automatically use the first non-empty column as the title and allow the user to pick a
different title column. Render the remaining values as `Field: value` lines. Empty values are
omitted. Duplicate headers receive deterministic suffixes.

### Limits

Start with conservative limits aligned with existing paste and note caps:

- 2 MB raw file size;
- 200 generated row cards per action;
- 100 columns;
- 100,000 characters in one cell;
- 500,000 characters in one generated note body;
- bounded preview rows and no unbounded DOM rendering.

When a file exceeds the row-card cap, keep the table-card option available if it fits. Otherwise
explain that the file should be split. Do not silently truncate rows or cells.

### Parsing behavior

- Strip an optional UTF-8 BOM.
- Normalize CRLF and CR line endings.
- Support quoted delimiters, escaped quotes, and quoted multiline cells.
- Detect tab for `.tsv`; for `.csv`, prefer comma and report ambiguous delimiter detection.
- Treat formula-looking values such as `=`, `+`, `-`, and `@` prefixes as inert text.
- Escape Markdown table pipes and backslashes.
- Never evaluate formulas, follow file links, fetch URLs, or interpret HTML in cells.

### Provenance

Extend source metadata with a delimited-file source:

```ts
{
	kind: 'table';
	title: string;
	format: 'csv' | 'tsv';
	row?: number;
}
```

The row number is one-based and refers to the source data row after the header. Table-card output
omits `row`.

### Implementation shape

- Add `csv` and `tsv` to the format registry and external-file batch.
- Add a pure bounded parser and conversion module.
- Reuse the existing dialog, focus trap, card-creation, placement, toast, and source-provenance
  patterns.
- Place generated cards using the existing set-placement path.
- Keep parsing synchronous only while the 2 MB cap remains responsive in profiling; otherwise move
  it behind a worker before raising limits.

## Documentation and visible copy

Update:

- `docs/file-formats.md` with the canonical matrices and compatibility policy;
- `docs/capabilities.md` with supported intake and export behavior;
- `docs/privacy-and-storage.md` with portable-file privacy implications;
- `docs/browser-support.md` with format-specific capability gaps;
- README input/output summary;
- empty drop guidance, Settings actions, file pickers, and unsupported-file messages.

Use `MASH desk bundle` and `MASH workspace backup`, not the ambiguous `sync file`, in user-facing
copy.

## Delivery slices

### Slice A — inventory and contract alignment

- Add the typed registry and consolidate duplicated limits.
- Publish the complete input/output and preservation matrices.
- Correct current UI guidance and any v5 scope mismatch.
- Add registry-to-documentation contract checks.

### Slice B — permanent compatibility fixtures

- Move representative legacy bundle objects into retained fixture files.
- Add canonical content and workspace round trips.
- Add malformed, boundary, and hostile fixtures for every current importer.

### Slice C — CSV/TSV intake

- Add bounded parsing and conversion.
- Build the preview/output-choice dialog.
- Wire drop, picker, provenance, and card placement.
- Add unit and end-to-end coverage.

### Slice D — release gate

- Add a compatibility check to CI.
- Require a matrix and fixture update for any new format, schema, limit, or preservation change.
- Verify the visible flow in Chromium and the supported cross-browser smoke path.

## Acceptance criteria

- Every accepted extension and MIME type is represented in one typed registry.
- File pickers, drop classification, visible guidance, and unsupported-file copy agree with the
  registry.
- The published matrix states maximums, preservation, losses, and security behavior for every
  supported format.
- Every supported legacy MASH bundle version has a permanent fixture and import test.
- Content and workspace round-trip tests compare the exact fields promised by the matrix.
- PDF, DOCX, HTML, image, GIF, JSON, and bundle hostile fixtures fail safely before writes.
- CSV and TSV correctly handle quoted delimiters, escaped quotes, multiline cells, Unicode, BOM, and
  formula-looking inert text.
- CSV/TSV never creates more than 200 cards in one action and never silently truncates accepted data.
- Documentation and UI call a desk-scoped artifact a desk bundle, not a whole-browser backup.
- CI fails when a format or bundle-version change ships without the required contract and fixtures.

## Non-goals

- Spreadsheet editing, calculation, charting, XLS/XLSX, or CSV export.
- Reconstructing PDF, DOCX, or HTML source documents from Mash excerpts.
- Watching or writing back to imported folders.
- Remote URL fetching or metadata scraping.
- Supporting every browser-recognized MIME type.
- Relaxing safety limits merely to accept pathological inputs.

## Sequencing with backup and recovery

Land Slice A before finalizing the workspace-backup schema. The compatibility matrix defines the
preservation promise; the backup implementation and round-trip fixtures prove that promise. CSV/TSV
can then proceed independently while backup restore work continues.

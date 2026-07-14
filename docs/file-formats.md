# File formats and compatibility

Mash uses files in three different ways:

- **Extraction:** open a source locally and clip useful text or pixels.
- **Content handoff:** move note content without promising the whole canvas model.
- **Workspace portability:** preserve a desk or the complete local workspace.

“Round trip” only applies to fields explicitly listed below. PDF, Word, and HTML are extraction
sources; Mash does not reconstruct those source documents.

## Input compatibility

| Format ID          | Extensions / MIME hints             | Entry points                           | Behavior                                     | Top-level limit                                          | Preservation                                                                                                 | Safety boundary                                                                          |
| ------------------ | ----------------------------------- | -------------------------------------- | -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `markdown`         | `.md`, `.markdown`, `text/markdown` | Drop, vault picker, Settings           | One note per file                            | 1 MB/file, 64 MiB total, 5,000 files                     | Title/body; relative folder, supported front matter, hashtags, and wikilinks on import                       | Bounded text and field normalization                                                     |
| `text`             | `.txt`, `text/plain`                | Drop, paste                            | One note/card per file or chosen paste split | 500,000 pasted characters; Markdown file limits for drop | Title/body                                                                                                   | Bounded text and generated-card count                                                    |
| `notes-json`       | `.json`, `application/json`         | Drop, picker, Settings, palette        | Validated note collection import             | 8,000,000 characters; 5,000 notes                        | Documented note fields only                                                                                  | Plain-data validation before writes                                                      |
| `mash-bundle`      | `.json`, `application/json`         | Drop, Settings, Finish, palette        | Import/export the active desk                | 8,000,000 characters                                     | Notes, active-desk layout, relationships, results, tombstones, and referenced assets emitted by that version | Versioned bounded parser and atomic IndexedDB writes                                     |
| `workspace-backup` | `.json`, `application/json`         | Drop, Settings, palette                | Preview and restore the whole workspace      | 50,000,000 characters; internal bundle caps still apply  | All sessions, notes, lifecycle, canvases, relationships, results, tombstones, and referenced assets          | SHA-256 corruption check, complete validation, impact preview, transaction-first restore |
| `pdf`              | `.pdf`, `application/pdf`           | Drop, picker, palette                  | Local reader; clip selected text or regions  | 50 MiB, 5,000 pages, bounded render pixels               | Filename/page provenance on clips                                                                            | No active content; bounded pages, bytes, canvas edge, and pixels                         |
| `docx`             | `.docx`, OOXML MIME                 | Drop, picker, Settings, palette        | Local sanitized reader; clip excerpts        | 8 MB compressed plus archive/image expansion caps        | Filename provenance on clips                                                                                 | Entry, expanded-byte, image-byte, pixel, and markup limits                               |
| `html`             | `.html`, `.htm`, HTML MIME          | Drop, picker, Settings, palette        | Local sanitized reader; clip excerpts        | 5 MiB                                                    | Filename provenance on clips                                                                                 | Scripts, active elements, event handlers, unsafe URLs, and remote resources removed      |
| `png`              | `.png`, `image/png`                 | Drop, paste, picker, Settings, palette | Visual sticky                                | 20 MiB source plus image limits                          | Local pixels and filename provenance                                                                         | Header, dimension, decoded-pixel, and per-action limits                                  |
| `jpeg`             | `.jpg`, `.jpeg`, `image/jpeg`       | Drop, paste, picker, Settings, palette | Visual sticky                                | 20 MiB source plus image limits                          | Local pixels and filename provenance                                                                         | Header, dimension, decoded-pixel, and per-action limits                                  |
| `webp`             | `.webp`, `image/webp`               | Drop, paste, picker, Settings, palette | Visual sticky                                | 20 MiB source plus image limits                          | Local pixels and filename provenance                                                                         | Header, dimension, decoded-pixel, and per-action limits                                  |
| `gif`              | `.gif`, `image/gif`                 | Drop, paste, picker, Settings, palette | One still or an evenly sampled frame set     | 20 MiB, 2,000 source frames, 36 generated frames         | Local pixels and filename provenance                                                                         | Header, frame-count, decoded-pixel, and generated-card limits                            |
| `csv`              | `.csv`, CSV MIME                    | Drop, picker, Settings, palette        | One card per row or one Markdown table card  | 2 MiB, 5,000 parsed rows, 100 columns, 200 row cards     | Header/value text plus filename and row provenance                                                           | Bounded quoted parser; formulas, URLs, and HTML remain inert text                        |
| `tsv`              | `.tsv`, `.tab`, TSV MIME            | Drop, picker, Settings, palette        | One card per row or one Markdown table card  | 2 MiB, 5,000 parsed rows, 100 columns, 200 row cards     | Header/value text plus filename and row provenance                                                           | Bounded quoted parser; formulas, URLs, and HTML remain inert text                        |

File extension and MIME are intake hints, not proof of safety. Each parser validates the selected
content again before persistence.

## Output compatibility

| Output                   | Scope                            | Preserves                                    | Does not preserve                                        |
| ------------------------ | -------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Clipboard Markdown       | Selected cards, results, or desk | Ordered title/body content                   | Canvas layout, lifecycle, operation history              |
| Downloaded Markdown      | Selected cards, results, or desk | Ordered title/body content                   | Canvas layout, lifecycle, operation history              |
| Notes JSON               | Current note collection          | Validated note fields covered by its schema  | Complete multi-desk lifecycle and layout                 |
| Print / PDF              | Selected cards, results, or desk | Browser-rendered readable result             | Editable source document or workspace model              |
| Board PNG                | Selected cards, results, or desk | Bounded visual layout and relationships      | Editable content and lifecycle                           |
| MASH desk bundle v5      | Active desk                      | Fields emitted by v5 for that desk           | Other local desks and complete workspace lifecycle       |
| MASH workspace backup v6 | Whole workspace                  | Declared workspace preservation matrix below | Cosmetic preferences, caches, clipboard data, or secrets |

## Preservation matrix

| Field                     | Markdown                        | Notes JSON          | Desk bundle v5               | Workspace backup v6       |
| ------------------------- | ------------------------------- | ------------------- | ---------------------------- | ------------------------- |
| Title and body            | Yes                             | Yes                 | Yes                          | Yes                       |
| Tags and folder           | Content/export-policy dependent | Yes                 | Yes                          | Yes                       |
| Source provenance         | Optional rendered content       | Yes when valid      | Yes                          | Yes                       |
| Pinned/kept state         | No                              | Limited note fields | Active-note fields only      | Yes                       |
| Scratch/recovery sessions | No                              | No                  | No whole-workspace guarantee | Yes                       |
| Canvas placement and size | No                              | No                  | Active desk                  | Yes                       |
| Edges and bowls           | No                              | No                  | When emitted for active desk | Yes                       |
| Referenced visual assets  | Content reference only          | Contract-specific   | Yes within desk caps         | Yes within workspace caps |
| Operation history         | No                              | Contract-specific   | Active desk                  | Yes                       |
| Deletion tombstones       | No                              | No                  | Active desk                  | Yes                       |

## CSV and TSV behavior

Mash strips an optional UTF-8 BOM, normalizes line endings, and supports quoted delimiters, escaped
quotes, and quoted multiline cells. Duplicate or blank headers receive deterministic names.

The preview offers:

- **One card per row:** up to 200 cards. The first non-empty column is the default title column and
  can be changed before import.
- **One Markdown table card:** keeps the accepted rows together when the generated body fits the
  500,000-character note limit.

Mash never evaluates formulas, follows cell links, interprets HTML, or silently truncates accepted
rows. Files outside the limits must be split before import.

## Desk bundles

Desk bundle exports currently use schema version 5. Import accepts versions 1 through 5 and
normalizes older shapes into the current active-desk model. A desk bundle is portable session data,
not a promise that every desk in the source browser is included.

Imports use local last-write-wins reconciliation for ordinary note metadata. When a newer incoming
body replaces a locally changed body, Mash can preserve a restorable local conflict copy.

## Workspace backups

Workspace backups use schema version 6 and include a SHA-256 digest to detect accidental file
corruption. The digest is not a digital signature and does not prove who created the file.

Before restore, Mash validates the complete file and shows its scope, contents, expected additions,
updates, removals, and conflicts. Existing local work is not erased merely because it is absent from
the backup. Newer values win during reconciliation.

## Compatibility policy

- New releases continue importing every bundle version listed as supported by the previous release.
- Removing a version requires a migration path and changelog entry.
- Bundle versions have retained fixtures that are not regenerated by the newest exporter.
- A format, limit, or preservation change requires a matrix update and boundary/hostile fixture.
- Exporters produce only the newest schema for their scope.
- Import never executes scripts, formulas, macros, or active document content.

## Board images and PDF

Board-image export produces PNG with a maximum dimension of 4,096 pixels and a maximum of 12 million
pixels. Print/PDF output uses the browser print pipeline and therefore depends on browser and
operating-system print support.

# File formats and compatibility

Mash supports content exports for handoff and versioned bundles for local workspace portability.

## Markdown

Copy and download actions produce ordinary Markdown. Titles and card boundaries are represented as headings and separators where needed. Markdown is the preferred human-readable handoff format and does not preserve the entire canvas model.

Markdown folder import supports:

- relative folders;
- YAML `title` and `tags` values;
- inline hashtags;
- `[[wikilinks]]`;
- up to 5,000 files within the documented size limits.

Import is one-shot. Mash does not watch or rewrite the source folder.

## Notes JSON

Notes JSON is a content-oriented backup for the note collection. Imports validate object structure, bound strings and arrays, reject unsupported sizes, and create safe IDs when needed. It does not carry the complete session and canvas history of a MASH bundle.

## MASH and sync bundles

Current exports use bundle schema version 5. The schema version is independent of the application release version.

Version 5 can contain:

- notes and deletion tombstones;
- canvases and placements;
- links, sequences, dismissals, and view state;
- scratch and kept sessions;
- operation receipts and lineage;
- referenced visual assets.

The importer accepts bundle versions 1 through 5 and normalizes older supported shapes into the current model. Unknown versions, malformed structures, excessive complexity, unsafe coordinates, and bundles over the size limit are rejected before writes begin.

Imports use local last-write-wins reconciliation for ordinary note metadata. When a remotely newer body would replace a locally changed body, Mash can preserve a restorable local conflict copy.

## Compatibility policy

- New releases should continue importing every bundle version listed as supported by the previous release.
- Removing an old version requires a documented migration path and a changelog entry.
- Schema changes require fixtures for the previous version, the new version, malformed input, and maximum supported complexity.
- Exporters only produce the newest schema version.
- Import never executes scripts or active document content contained in a bundle.

## Board images and PDF

Board-image export produces PNG with a maximum dimension of 4,096 pixels and a maximum of 12 million pixels. Print/PDF output uses the browser print pipeline and therefore depends on browser and operating-system print support.

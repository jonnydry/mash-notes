# Architecture

Mash is a client-only SvelteKit application built as a static single-page PWA. Its architecture is organized around a local session workbench rather than a server-backed notes account.

## Runtime boundary

- Svelte 5 and SvelteKit compose the application and static routes.
- The static adapter writes the deployable site to `build/`.
- Dexie provides IndexedDB persistence.
- MiniSearch indexes the local note collection.
- A generated service worker caches the application shell and loaded deferred assets.
- There is no application API, remote database, authentication service, or server-rendered user state.

## Domain model

### Notes and assets

Notes hold text, metadata, links, source lineage, and optional references to locally stored visual blobs. Imported active content is converted into bounded inert data before it reaches a rendered surface.

### Desks and sessions

A desk is a spatial canvas inside a session. Sessions are either scratch or kept and can be active or recovering. Placements are separate from notes so a note can be represented without baking canvas coordinates into its content model.

### Operations

Set operators record input IDs, output IDs, timestamps, and bounded payload metadata. Operation receipts make transformations explainable and reversible when the underlying action supports it.

### Portability

Content exports produce Markdown, PDF, or PNG. A versioned desk bundle preserves one active working
session. A workspace backup preserves every local session covered by the v6 contract, including
session lifecycle, canvases, relationships, operation history, tombstones, and referenced visual
assets. Workspace backups are serialized, reparsed, count-checked, and protected by a SHA-256
corruption digest before download.

## Data flow

1. Intake adapters classify paste, drop, picker, or import input.
2. Parsers validate type, structure, size, archive expansion, dimensions, and complexity.
3. Sanitizers convert supported content to inert note or asset drafts.
4. Stores commit notes, blobs, placements, sessions, and operations to IndexedDB.
5. UI stores refresh the active desk and local search index.
6. Finish/export adapters serialize a selected scope without mutating lifecycle state.
7. A separate Finish commit applies keep, leave, or clear decisions transactionally where possible.
8. Workspace restore validates the complete file, builds a read-only impact plan, and only writes
   after explicit confirmation.

## Safety design

- Content Security Policy and static-host headers restrict script, frame, object, and network behavior.
- Markdown and imported HTML block active markup and unsafe URL protocols.
- Document, image, archive, paste, bundle, and export surfaces enforce explicit resource limits.
- File parsing is lazy-loaded to keep initial startup small and reduce exposure before a feature is invoked.
- Synchronization and session writes are serialized to avoid lost updates.
- Storage failures preserve an export path instead of trapping work in a broken local state.
- Workspace backup digests detect accidental corruption; they are not signatures and do not make an
  untrusted backup authoritative.

## Performance design

Heavy readers, PDF tooling, board-image export, dialogs, and non-default fonts are excluded from the initial application graph and PWA precache. `scripts/check-performance-budget.mjs` enforces budgets for initial JavaScript, CSS, and fonts after every production build.

## Testing layers

- Vitest covers parsers, sanitizers, stores, lifecycle logic, geometry, operators, export planning, and failure paths.
- Svelte Check and TypeScript validate component and application contracts.
- ESLint and Prettier enforce repository hygiene.
- Playwright covers the main user workflow, accessibility behaviors, readers, file intake, session
  lifecycle, CSV/TSV intake, verified backup/restore, export, mobile layout, and desk-bundle import.
- Production builds and bundle budgets guard deployability and startup weight.

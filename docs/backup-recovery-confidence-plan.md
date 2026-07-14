# Mash backup and recovery confidence plan

Status: Implemented
Target: v0.3 Trust Release
Owner: Product and engineering
Updated: 2026-07-13

Implementation landed as the version 6 workspace backup path, backup-health model, preview-first
restore dialog, conflict-review handoff, quota rollback coverage, and full browser round-trip test.

## Outcome

People should be able to answer three questions without understanding browser storage:

1. Is my current work only in this browser?
2. Do I have a recent portable copy?
3. Can Mash safely tell me what will happen before I restore one?

Mash should make a portable backup easy to create, verify the generated data before download,
preview a restore before any writes, and preserve an immediate content escape path when browser
storage fails.

This work is about confidence, not cloud sync. Mash remains account-free, local-first, and fully
usable offline.

## Product decision: separate desk portability from workspace backup

The current MASH bundle path is centered on the active desk. That is useful for handoff and moving a
working session, but it is not the same promise as backing up everything stored by Mash.

Use two explicit concepts:

| Artifact             | Entry point          | Scope                                                                                             | User promise                          |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Desk bundle**      | Finish               | Active desk, its cards, layout, assets, and result history                                        | Move or preserve this working session |
| **Workspace backup** | Data / backup status | All scratch and kept desks, recovering desks, notes, assets, relationships, and operation history | Restore the complete Mash workspace   |

Do not label a desk-scoped export as a backup of the browser. Existing version 1–5 bundles remain
importable and are described as legacy or desk bundles according to their contents.

## Existing foundation to keep

Mash already has most of the difficult primitives:

- Versioned JSON bundle parsing with bounded structures and support for versions 1–5.
- Note, canvas, edge, operation, tombstone, and visual-asset validation.
- Last-write-wins reconciliation and restorable body-conflict copies.
- Storage usage, quota pressure, and persistent-storage inspection.
- A gentle seven-day export reminder and last export/import timestamps.
- Export access through Finish, Settings, and the command palette.
- Content export paths that stay available when local lifecycle writes fail.

The plan should consolidate and extend these paths rather than introduce a parallel backup stack.

## Current confidence gaps

1. Backup status is buried in Settings and primarily reports a timestamp.
2. A successful download initiation is treated as success even though the generated payload is not
   reparsed and compared before download.
3. The current status does not say whether meaningful changes happened after the last export.
4. Import begins after validation but does not show a human-readable impact preview first.
5. “Sync bundle,” “desk bundle,” and “backup this browser” currently blur different scopes.
6. The published v5 compatibility description must be reconciled with the fields actually emitted.
7. Recovery coverage needs fixtures for every supported bundle version, corruption, partial data,
   quota failure, and larger realistic workspaces.

## Experience principles

### Calm, not alarming

Backup status belongs in the Desks panel and Data settings, not as permanent canvas chrome. Show a
gentle indicator after meaningful work exists. Escalate only when the browser reports storage
pressure or a write fails.

### Honest language

- `Stored in this browser` describes the local copy.
- `Workspace backup` describes a user-downloaded portable copy.
- `Desk bundle` describes a portable active session.
- `Browser-protected storage` is not called a backup.
- `Backup checked before download` means structural and integrity validation succeeded; it does not
  claim Mash can prove that the user kept the downloaded file.

### Restore is preview-first

Selecting a backup never writes immediately. Mash first validates it and shows its date, schema,
scope, contents, conflicts, and likely changes. The user then chooses whether to continue.

### Failure never traps content

If IndexedDB is unavailable or full, keep the in-memory edit, keep Copy Markdown and Download
Markdown available, offer a desk bundle when it can still be constructed, and explain which local
changes could not be committed.

## Backup-health model

Represent health as a small derived model rather than scattered timestamps:

```ts
type BackupHealthState =
	| 'empty'
	| 'never-backed-up'
	| 'current'
	| 'changes-since-backup'
	| 'stale'
	| 'storage-warning'
	| 'storage-critical'
	| 'unknown';

interface BackupRecord {
	createdAt: number;
	workspaceChangedAt: number;
	scope: 'desk' | 'workspace';
	bundleVersion: number;
	byteLength: number;
	digest?: string;
	counts: {
		sessions: number;
		notes: number;
		assets: number;
		operations: number;
	};
}
```

For the first release, derive `workspaceChangedAt` from existing durable timestamps: session
`lastMeaningfulActivityAt`, active and deleted note timestamps, canvas modification times, and
operation creation/reversion. Do not wire a new global revision through every mutation path until
profiling proves the derived scan is too costly.

Store the latest successful workspace `BackupRecord` locally. A desk-bundle export does not mark the
whole workspace current.

## Target flows

### 1. First meaningful backup

After the workspace contains meaningful user work, the Desks panel shows:

`Only in this browser · Make a backup`

The action:

1. Flushes pending edits when possible.
2. Builds a whole-workspace backup.
3. Serializes it once.
4. Reparses and validates the serialized payload.
5. Confirms counts and referenced asset IDs match the source snapshot.
6. Optionally calculates a SHA-256 integrity digest with Web Crypto.
7. Starts the download only after those checks pass.
8. Records backup health only after the browser accepts the download action.

Success copy:

`Workspace backup created · 4 desks · 37 cards`

Failure copy must identify whether Mash could not read local data, construct the backup, validate it,
or start the download.

### 2. Subsequent backup

The compact states are:

- `Backed up today`
- `Changes since last backup`
- `Last backup 9 days ago`
- `Storage nearly full · Back up now`

Use the existing seven-day reminder as the initial stale threshold. A new meaningful change moves
`current` to `changes-since-backup`; merely opening, searching, panning, or exporting content does
not.

### 3. Restore preview

After the user chooses a file, show one compact dialog:

- Backup date and application/bundle version.
- Workspace or desk scope.
- Counts for desks, notes, assets, and operation receipts.
- Estimated additions, updates, unchanged items, removals, and conflicts.
- Any unsupported or omitted data.
- A warning when the backup predates the latest known local backup or meaningful change.

Primary action: `Restore backup`
Secondary action: `Cancel`

For legacy desk bundles, use `Import desk bundle` and say that existing local work will remain.

The preview is computed by a pure planning function. It performs no IndexedDB or localStorage
writes.

### 4. Restore commit and receipt

On confirmation:

1. Flush pending local edits.
2. Revalidate the exact selected payload.
3. Apply all IndexedDB changes in the smallest safe transaction set.
4. Apply localStorage-backed view state only after IndexedDB commits.
5. Refresh search, sessions, canvases, storage health, and conflicts.
6. Record the import only after the commit succeeds.
7. Show a receipt built from completed facts.

Example:

`Restored 3 desks · 18 cards added · 4 updated · 1 conflict saved for review`

If the transaction fails, the visible workspace must remain in its pre-restore state after reload.

### 5. Storage failure escape hatch

When a write fails:

- Keep the editor open and preserve its in-memory text.
- Show a persistent status rather than a short toast.
- Offer `Copy current note`, `Download current desk as Markdown`, and `Try workspace backup` when the
  required data is readable.
- Do not report the note, lifecycle change, or backup as saved when it was not.
- Refresh storage pressure after retry.

## Workspace backup format

### Versioning decision

Introduce a new workspace-capable bundle version only after the emitted contract is finalized. Keep
the parser for versions 1–5 unchanged.

The next schema should include:

```ts
interface WorkspaceBackup {
	kind: 'mash-backup';
	version: 6;
	scope: 'workspace';
	exportedAt: number;
	appVersion: string;
	sessions: Session[];
	notes: Note[];
	canvases: Canvas[];
	canvasItems: CanvasItem[];
	canvasEdges: CanvasEdge[];
	operations: Operation[];
	blobs: SyncBlob[];
	tombstones: SyncTombstone[];
	dismissed: DismissedByCanvas;
	integrity?: {
		algorithm: 'SHA-256';
		digest: string;
	};
}
```

The integrity digest detects accidental corruption, not malicious tampering or file authenticity.
Document that distinction.

Do not include cosmetic preferences, clipboard contents, transient dialogs, search indexes, cached
reader modules, or secrets. Include recovering desks because a whole-workspace restore promise must
not silently discard recoverable content.

### Size strategy

Keep JSON as the first workspace format because it is inspectable and reuses current validation. Set
an explicit whole-workspace cap based on realistic fixtures rather than reusing the current 8 MB
desk-bundle cap blindly.

If image-heavy workspace fixtures make JSON impractical, make a `.mash` ZIP container with a bounded
manifest and separate asset entries a follow-up schema. Do not introduce that container without zip
entry-count, expanded-size, per-entry, and aggregate pixel limits.

## Technical work

### Shared backup domain

Add a small domain layer, separate from Svelte components:

- `buildWorkspaceBackup()`
- `serializeAndVerifyBackup()`
- `inspectBackup()`
- `planBackupRestore()`
- `applyBackupRestore()`
- `deriveBackupHealth()`

The page coordinates these operations; Settings, Finish, and the Desks panel consume the same state
and actions.

### Restore planning

Reuse pure merge logic where possible. The plan result should include:

```ts
interface RestorePlan {
	valid: boolean;
	scope: 'desk' | 'workspace';
	version: number;
	counts: BackupRecord['counts'];
	added: number;
	updated: number;
	unchanged: number;
	removed: number;
	conflicts: number;
	warnings: string[];
}
```

Parsing, normalization, integrity checks, reference checks, and restore planning must remain free of
side effects and be exhaustively unit-tested.

### UI integration

- Desks panel: compact backup state and one action.
- Settings / Data: full status, last workspace backup, last restore, storage usage, Back up, Restore.
- Finish: rename the existing action to `Desk bundle` and state its active-desk scope.
- Command palette: `Back up workspace…`, `Restore workspace backup…`, `Export desk bundle…`, and
  `Import desk bundle…`.
- Replace user-facing `sync` terminology while keeping internal names temporarily to limit churn.

## Verification matrix

### Unit coverage

- Backup-health state transitions, including no data, new changes, stale time, and quota pressure.
- Version 1–5 compatibility fixtures and a complete version 6 fixture.
- Malformed JSON, unknown version, duplicate IDs, missing references, unsafe coordinates, invalid
  blobs, excessive counts, and integrity mismatch.
- Export serialize/reparse/count parity.
- Pure restore-plan counts against empty, older, newer, conflicting, and tombstoned local data.
- Failed transaction does not record a successful restore.
- Failed generation or download does not record a successful backup.

### End-to-end coverage

1. Create work in two desks, back up the workspace, clear IndexedDB, restore, and verify both desks,
   their placements, assets, and operation receipts.
2. Export a desk bundle from Finish and confirm that it does not claim to back up other desks.
3. Preview a restore with local conflicts and confirm no data changes before approval.
4. Force quota failure and verify the current text and content exports remain available.
5. Import every retained legacy fixture through the visible file flow.
6. Exercise Chromium plus the cross-browser smoke path for backup and restore.

### Manual checks

- Offline installed PWA.
- Private browsing or blocked persistence.
- Browser download permission denied.
- Storage warning and critical states.
- Keyboard-only operation, screen-reader announcements, 200% zoom, and narrow mobile layout.

## Delivery slices

### Slice A — honest terminology and backup health

- Separate desk bundle from workspace backup in product copy.
- Add the derived health model and compact Desks-panel status.
- Reuse the existing v5 export for desk bundles.
- Correct documentation that overstates current v5 scope.

### Slice B — verified workspace backup

- Finalize the workspace schema and fixtures.
- Build all-session export and structural/integrity verification.
- Add the one-click backup action and accurate receipt.

### Slice C — preview-first restore

- Add inspection and pure restore planning.
- Build the preview dialog and atomic apply path.
- Preserve and surface conflicts.

### Slice D — failure and longevity hardening

- Add quota/corruption/interruption fixtures.
- Add the persistent failure escape hatch.
- Run realistic multi-desk and image-heavy soak tests.

## Acceptance criteria

- A user can create a whole-workspace backup in one visible action.
- Mash validates the generated payload before download and never records a failed attempt as success.
- The UI distinguishes a desk bundle from a whole-workspace backup everywhere.
- Backup status identifies meaningful changes made after the last successful workspace backup.
- Restore shows scope and impact before it writes.
- A failed restore leaves the prior durable workspace intact.
- Versions 1–5 remain importable through retained fixtures.
- A whole-workspace round trip preserves every field promised by the file compatibility contract.
- Storage failure preserves an immediate path to copy or download readable content.

## Non-goals

- Accounts, cloud storage, background sync, or scheduled uploads.
- Claiming a downloaded file exists after the browser hands it off.
- Encrypting backups in this release; users can store files in their existing encrypted location.
- Replacing explicit user downloads with browser file-system permissions.
- Automatic destructive cleanup of kept work.

## Dependency on the file compatibility contract

The file compatibility contract should land first or alongside Slice A. It defines what a desk bundle
and workspace backup preserve, which versions remain supported, and the fixtures required before a
schema change can ship.

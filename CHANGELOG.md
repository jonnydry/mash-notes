# Changelog

Notable changes to Mash are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and release versions follow semantic versioning while the portable bundle schema is versioned independently.

## [1.0.0] - Unreleased

### Added

- First-class scratch and kept desks with expiration and recovery behavior.
- A consolidated Finish flow for selected cards, operation results, or the whole desk.
- Markdown, PDF, board-image, and MASH bundle takeaway options.
- Reversible set operators with visible operation receipts.
- Local readers and clipping flows for PDF, Word, and HTML documents.
- Visual stickies for PNG, JPEG, WebP, and GIF, including bounded GIF frame extraction.
- Local URL source cards without remote metadata fetching.
- Version 5 portable bundles with visual assets, sessions, operations, and older-version import support.
- Production security headers, stricter content sanitization, and bounded import/decode limits.
- Performance budgets for initial JavaScript, CSS, and fonts.
- Open-source security, contribution, architecture, privacy, format, and browser-support documentation.
- CSV and TSV intake with a bounded preview-first choice between row cards and a Markdown table card.
- Verified version 6 workspace backups with whole-workspace health, corruption checks, restore impact
  previews, and transaction-first recovery.
- Retained compatibility fixtures for every supported desk and workspace bundle version.
- A production PWA registration path and an automated offline-reopen contract that preserves local notes.

### Changed

- Repositioned Mash as a local-first scratch workbench rather than a permanent notes repository.
- Deferred document readers, export tooling, dialogs, and non-default fonts from the initial application graph.
- Strengthened storage failure recovery and synchronization ordering.
- Made the full repository lint and formatting gate enforceable in CI.
- Clarified desk bundles versus complete workspace backups throughout Settings, Finish, the command
  palette, and public documentation.
- Centralized supported file extensions, MIME hints, entry points, preservation levels, and top-level
  limits in a typed compatibility registry.
- Made local browser tests serve the same static `build/` artifact that ships in releases.
- Made tagged releases run the full lint, type, unit, build, performance, Chromium, Firefox, and WebKit gates.
- Made pull-request and release gates enforce the high-severity dependency audit.

### Fixed

- Restored the missing installable-manifest link and service-worker registration.
- Added the static SPA shell to the Workbox precache so a controlled desk can reopen without a network.
- Corrected the static-host cache rule from the obsolete `/service-worker.js` path to `/sw.js`.
- Removed an unreferenced duplicate icon source folder from the public release payload.
- Kept the first-run “Try a mash” action hidden until its desk is ready to accept cards.

### Security

- Blocked unsafe URL schemes and active imported markup.
- Added archive, file-size, decoded-pixel, page-count, frame-count, and bundle-complexity limits.
- Added restrictive CSP and static-host security headers.
- Hardened malformed JSON, Markdown, DOCX, HTML, PDF, image, GIF, and sync-bundle handling.
- Kept CSV/TSV formulas and markup inert, bounded rows/columns/cells, and required complete workspace
  validation before restore can write.

[1.0.0]: https://github.com/jonnydry/mash-notes/releases/tag/v1.0.0

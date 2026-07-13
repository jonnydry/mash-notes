# Changelog

Notable changes to Mash are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and release versions follow semantic versioning while the portable bundle schema is versioned independently.

## [0.2.0] - Unreleased

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

### Changed

- Repositioned Mash as a local-first scratch workbench rather than a permanent notes repository.
- Deferred document readers, export tooling, dialogs, and non-default fonts from the initial application graph.
- Strengthened storage failure recovery and synchronization ordering.
- Made the full repository lint and formatting gate enforceable in CI.

### Security

- Blocked unsafe URL schemes and active imported markup.
- Added archive, file-size, decoded-pixel, page-count, frame-count, and bundle-complexity limits.
- Added restrictive CSP and static-host security headers.
- Hardened malformed JSON, Markdown, DOCX, HTML, PDF, image, GIF, and sync-bundle handling.

[0.2.0]: https://github.com/jonnydry/mash-notes/releases/tag/v0.2.0

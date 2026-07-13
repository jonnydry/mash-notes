# Privacy and storage

Mash is designed to process user material locally in the browser. This document describes the application boundary, not the behavior of the browser, operating system, extensions, network, or static hosting provider.

## What Mash stores

Mash uses IndexedDB through Dexie for:

- notes and visual-asset metadata;
- image and document-derived blobs;
- desks, placements, links, and groups;
- session lifecycle and recovery state;
- reversible operation history;
- sync tombstones and conflict metadata.

Small interface preferences and health markers use local storage.

## What Mash sends

The application has no account service, analytics integration, remote note database, or content-processing API. Note bodies and imported files are not intentionally transmitted to a Mash backend because no such backend exists.

The deployed application still performs ordinary requests to its static origin for HTML, JavaScript, CSS, fonts, icons, the service worker, and deferred application modules. A hosting provider, browser, extension, operating system, or network administrator may observe those requests according to their own policies.

Pasted HTTP(S) URLs become local cards. Mash derives a title from the URL locally and does not fetch the destination for metadata.

## Scratch, kept, and recovery

New desks are temporary by default:

- Scratch desks expire after 14 days of meaningful inactivity unless the user changes the supported retention preference.
- Expired or manually cleared desks move to Recently cleared.
- Recently cleared desks remain recoverable for 7 days.
- Kept desks and kept results do not auto-clear.

The Finish panel states what will be exported and what will remain locally before lifecycle changes are committed.

## Failure behavior

Browser storage can fail because of quota pressure, private-mode restrictions, device storage problems, browser cleanup, or profile corruption. Mash attempts to:

- keep the in-memory edit available;
- report persistent-storage failures plainly;
- retain copy and download paths;
- avoid reporting an export or lifecycle change as successful when it failed;
- keep destructive actions explicit.

These safeguards are not a substitute for an off-device backup. Export a MASH bundle for portable recovery.

## Portable copies

Mash exports data only after a user action. Downloads and clipboard writes remain subject to browser permissions and policies. Portable files may contain private note text, filenames, source URLs, visual assets, relationships, and operation history. Treat them with the same care as the original material.

## Self-hosting

Self-hosters control the static origin, headers, deployment logs, and update policy. Preserve the supplied security headers and Content Security Policy, serve over HTTPS outside local development, and review changes before deploying them to users who trust that origin.

# URL source cards (paste intake)

**Date:** 2026-07-11  
**Status:** Implementation  
**Product:** Mash notes PWA  
**Season:** Intake expansion — Images → **Links** → Documents  
**Depends on:** Image visual stickies branch patterns (`placeNoteDraftsOnDesk`, composed clipboard)

## Problem

Pasting a link on the desk today becomes a plain text sticky (or multi-line paste dialog). Users want a **source card** they can mash with thoughts—lightweight provenance without cloud scraping or accounts.

## Goals

1. Paste one or more `http(s)` URLs (one per line) → URL source card(s) on the desk.
2. Cards carry `source: { kind: 'url', title, url }` and a markdown link body.
3. Stay **local-first**: no network fetch for Open Graph/titles in v1 (hostname-based title).
4. Do not steal normal text paste when content is not URL-only.

## Non-goals

- Fetching remote page titles, favicons, or previews
- Browser extension / share-target (later)
- `file://`, custom schemes, or shortened-link expansion
- Dropping `.url` / `.webloc` files (optional later)
- Auto-tag `url`

## Product behavior

| Clipboard text                        | Behavior                                                        |
| ------------------------------------- | --------------------------------------------------------------- |
| Single line that is an `http(s)` URL  | One URL source card (no paste-split dialog)                     |
| Multiple lines, each an `http(s)` URL | One card per URL (set layout)                                   |
| Image present                         | Image path wins (existing); URL text may become caption if both |
| Mixed URL + non-URL lines             | Existing text paste / split dialog                              |
| Non-http schemes                      | Treated as normal text                                          |

**Title:** URL hostname without leading `www.` (fallback `Link`).  
**Body:** `[title](url)` plus the raw URL on a following line for copy visibility.  
**Source:** `{ kind: 'url', title, url }` with normalized href.

**Cap:** Same spirit as paste — max 50 URL cards per paste (align with image multi-import).

## Architecture

| Piece                   | Role                                        |
| ----------------------- | ------------------------------------------- |
| `src/lib/url-source.ts` | Detect, normalize, title, draft body/source |
| `types.ts`              | `NoteSource` += url                         |
| `import-notes.ts`       | Validate url source on JSON import          |
| `+page.svelte`          | Paste branch before text split dialog       |
| `CanvasBoard.svelte`    | Source footer for url                       |
| `board-image-export.ts` | sourceLabel for url                         |

## Testing

- Unit: parse valid/invalid URLs; multi-line URL list; reject mixed content as non-url-only.
- E2E: paste single URL on canvas → card with title/host.

## Follow-on

- Optional client-side title fetch behind a setting
- Documents slice (EPUB/HTML/Pages-via-PDF) next

# HTML document reader (canvas drop + open)

**Date:** 2026-07-11  
**Status:** Implementation  
**Product:** Mash notes PWA  
**Season:** Intake expansion — Images → Links → **Documents (HTML)**

## Problem

Saved web pages and HTML exports are common writing sources. Users want the same read → clip loop as PDF/docx without a browser tab detour.

## Goals

1. Drop or open `.html` / `.htm` → read-only reader (shared shell with Word).
2. Select text → sticky with `source: { kind: 'html', title }`.
3. Sanitize local HTML (strip scripts/handlers); no remote resource loading product requirement.
4. Lazy-load reader UI.

## Non-goals

- Full browser fidelity (CSS remote assets, JS apps)
- EPUB / Pages in this slice
- Editing HTML round-trip

## Approach

Sanitize with DOMParser (browser) / conservative strip (node); render like DocxReader; classify via `external-file-drop` `html` kind.

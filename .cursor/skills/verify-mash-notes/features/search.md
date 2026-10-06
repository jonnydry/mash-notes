# Search notes

Search lets a person find a note from the header field and see a clear empty state when nothing matches.

## Sub-features

- `search-open` focuses the header field from the dock.
- `search-match` lists the welcome note for the query `Scoop`.
- `search-empty` shows the empty copy for a query that matches nothing.

## How to get to it (user POV)

- Choose `Search` in the Mash dock.
- Press `/` while `document.activeElement` is `BODY`. The key does nothing useful inside a field.

## Driving it with verify-mash-notes

Preconditions:

- Doctor reports `http://127.0.0.1:4183`.
- Ingredients already contains `Hi — I'm Scoop`.

- **Open search.** Run `node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature search`. The script clicks the dock button named `Search`.
- **Match.** It fills `#global-search`, whose placeholder is `Search notes to grab…`, with `Scoop`. The listbox named `Search results` contains an option whose name includes `Hi — I'm Scoop`. `search-scoop.png` shows that list.
- **Empty.** It replaces the query with `volcano-not-a-note`. The page shows text matching `No notes match`. `search-empty.png` shows that state.
- **Report.** `search.json` has `"ok": true` and the only aborted host is `example.com`.

## Gotchas

- An empty query does not open the listbox. Fill a non-empty query before expecting `Search results`.
- The option's accessible name comes from the row text, including the title `Hi — I'm Scoop`.
- Pressing `/` inside the search field types a slash. The dock button is the entry this file drives.

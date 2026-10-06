---
name: verify-mash-notes
description: Drive Mash (mash-notes), the local-first desk in the browser, against a scrubbed local static preview. Use when a change needs install, lint, check, unit test, build, or headless proof of notes, search, mash, finish, or the phone notice.
---

# Verify Mash

Mash is a browser app. Notes live in IndexedDB database `mashdb-notes-v1` and in `localStorage` inside the browser profile. There is no account, no API key, and no server database. Do not add a seed script or a connection-string guard. This skill keeps each drive on a new Chromium profile under `/tmp` and deletes that profile when the drive finishes.

Run every command from the repository root. There is no script named `typecheck`. Typecheck is `npm run check`. There is no `.env` example and no `.env.test`. A scan of `src`, `scripts`, `playwright.config.ts`, `vite.config.ts`, and `svelte.config.js` finds `CI` and `MASH_EXPORT_QA_DIR` only. Neither is a secret. `SECRET_ENV_KEYS` and `ORIGIN_ENV_KEYS` in `scripts/policy.mjs` are the locked lists, and both are empty.

## Commands

These commands are the verification gate. Run them in this order.

```bash
npm ci
npm run lint
npm run check
npm test
npm run build
npm run perf:budget
npm run check:deploy
npx playwright install chromium
node --test .cursor/skills/verify-mash-notes/scripts/policy.test.mjs
node .cursor/skills/verify-mash-notes/scripts/launch.mjs
node .cursor/skills/verify-mash-notes/scripts/doctor.mjs
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature create-note
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature mobile
node .cursor/skills/verify-mash-notes/scripts/cleanup.mjs
```

`npm test` is the one-shot unit run (`vitest --run`). `npm run test:unit` without `--run` starts watch mode. Do not use it here.

`npm run lint` is `prettier --check . && eslint .`. `npm run format` rewrites files. Do not use it as a check.

`npm run preview` serves `build/` but inherits the parent environment. Verification does not call it. `launch.mjs` runs `node scripts/serve-static.mjs --host 127.0.0.1 --port 4183` in a scrubbed child process.

`npm run dev` starts Vite on port 5173. That is the documented development server. It is not the verification server.

These scripts exist and are outside this gate.

- `npm run audit:security` is `npm audit --audit-level=high`. The lockfile reports a high advisory, so this command exits non-zero. Do not treat that exit as a desk failure.
- `npm run test:e2e` runs Playwright Chromium against `http://127.0.0.1:4173`.
- `npm run test:e2e:cross-browser` runs `e2e/smoke.spec.ts` on Firefox and WebKit.
- `npm run ci` chains lint, check, the audit, build, budgets, the deploy contract, unit tests, and both Playwright suites.
- CI installs browsers with `npx playwright install --with-deps chromium firefox webkit`. This skill's drive needs Chromium only.

After a desk change, also drive the matching feature from `features/`. `create-note` and `mobile` are the minimum browser proof.

## Launch

```bash
node .cursor/skills/verify-mash-notes/scripts/launch.mjs
```

Ready when stdout contains `Mash static preview: http://127.0.0.1:4183` and `doctor.mjs` prints `doctor ok`. The server log is `/tmp/verify-mash-notes/server.log`. The pid is `/tmp/verify-mash-notes/state.json`.

The child environment keeps `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, `LC_CTYPE`, `SHELL`, and `TERM` when the parent set them. Every parent name that looks like a secret is set to an empty string. Every parent name that looks like an origin URL is set to `http://127.0.0.1:4183`. `SECRET_ENV_KEYS` and `ORIGIN_ENV_KEYS` are applied the same way. Other parent variables are dropped, including `NODE_OPTIONS`. The listen address is the CLI flag `--host 127.0.0.1`. Launch refuses a busy port instead of attaching to a foreign process.

Set `VERIFY_MASH_NOTES_PORT` and `VERIFY_MASH_NOTES_STATE` together when a second preview must run beside the first. The default state directory is one instance.

`npm run build` must already have written `build/index.html`. Launch exits non-zero when that file is missing.

## Doctor

```bash
node .cursor/skills/verify-mash-notes/scripts/doctor.mjs
```

Run this before the first drive and again after a drive that behaved strangely. It exits non-zero unless all of these are true.

- `state.json` exists and its pid is alive.
- That pid's command line includes `serve-static.mjs`.
- `GET` of the recorded origin returns HTTP 200 and the static shell (`data-sveltekit-preload-data` and `/_app/immutable/`). The word Mash is not in `index.html`. It is in `/manifest.webmanifest` as `"name":"Mash"`.
- If `ss` reports a listener pid, it is the recorded pid.

Stdout includes `auth none` and `storage browser-indexeddb`. Mash has no sign-in. Do not mint a session and do not use a real account.

## Drive

Read `features/README.md`, then the feature file. One fresh Chromium profile per drive. The profile path is under `/tmp/verify-mash-notes/profiles/` and the script deletes it before exiting.

```bash
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature create-note
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature search
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature mash
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature finish
node .cursor/skills/verify-mash-notes/scripts/drive.mjs --feature mobile
```

The driver aborts any request whose host is not `127.0.0.1`, `localhost`, `::1`, or `[::1]`. `data:`, `blob:`, and `about:` are allowed. An unparseable URL is aborted. The aborted URL, host, and reason are stored on the feature report. After the screenshots, the driver navigates to `https://example.com/verify-mash-notes-probe`. That navigation must appear in the aborted list. A page `fetch` would not, because the app CSP sets `connect-src 'self'` and the browser drops it before a request exists. Any other aborted host fails the drive. The browser context sets `serviceWorkers` to `block`. The console line `Mash offline support could not start` is that block, and the drive does not count it as a failure.

Desktop drives use a 1280 by 800 viewport. `New note` must sit inside that viewport and measure at least 44 by 44 CSS pixels before the click.

`mobile` checks 375 by 812 and 390 by 844 with touch emulation (`hasTouch` and `isMobile`). Below 960px CSS width the layout renders the phone notice and does not mount the desk. The heading `Mash is currently optimized for desktop use.` and the notice card must sit inside the viewport. `documentElement.scrollWidth` must be less than or equal to `clientWidth`. Every visible button, link, or field must sit inside the viewport and measure at least 44 by 44. The current notice has no such controls. The drive taps the heading and requires it to remain.

## Evidence

The drive writes `.cursor/skills/verify-mash-notes/runs/`. That path is resolved from the script file, not the shell working directory. Set `VERIFY_MASH_NOTES_EVIDENCE_DIR` to write somewhere else. The drive creates the directory. `runs/` is gitignored and excluded from Prettier. Cleanup does not delete the evidence directory.

- `create-note-boot.png`, `create-note-saved.png`, and `create-note-reloaded.png` show the desk, the new card, and the same card after reload.
- `search-scoop.png` and `search-empty.png` show a match and the empty copy.
- `mash-result.png` shows the combined card.
- `finish-open.png` shows the Finish dialog.
- `mobile-375.png` and `mobile-390.png` show the phone notice.
- `<feature>.json` records `ok`, screenshots, aborted requests, `consoleErrors`, `pageErrors`, and `networkErrors`.

A passing drive has empty `consoleErrors`, `pageErrors`, and `networkErrors`. The reloaded note must be visible in Ingredients and stored in IndexedDB `mashdb-notes-v1` with the same title and body. Do not prove a note by reading only the field you just typed.

## Cleanup

```bash
node .cursor/skills/verify-mash-notes/scripts/cleanup.mjs
```

Cleanup sends `SIGTERM` to the pid in `state.json`, then `SIGKILL` if it is still alive. It kills that pid only when `/proc/<pid>/cmdline` contains `serve-static.mjs`. It then deletes the state directory. The state directory must resolve under `/tmp` and must not be the evidence directory. After cleanup, the png and json files in the evidence directory must still be there.

Run cleanup after a failed launch too, so a later run does not inherit a dead pid file.

## Helpers

The scripts are executable. Invoke them with `node` and the paths above.

- `scripts/policy.mjs` holds the locked env lists, the child-env builder, the request-host decision, and the delete fence.
- `scripts/policy.test.mjs` locks those rules. `node --test .cursor/skills/verify-mash-notes/scripts/policy.test.mjs` runs it.
- `scripts/launch.mjs`, `scripts/doctor.mjs`, `scripts/drive.mjs`, and `scripts/cleanup.mjs` are the commands in the sections above.

Keep the map honest with `/maintain-verification-skill` when desk behavior changes.

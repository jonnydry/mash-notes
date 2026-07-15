# V1 release readiness

Mash V1 is a dependable local utility, not a promise of every possible text workflow. A release is ready when the existing intake → manipulate → takeaway loop is safe, recoverable, portable, and independently verifiable.

## Candidate status

The repository is prepared as a `1.0.0` release candidate. No stable tag should be created unless every automated gate below passes on the exact commit being tagged.

Verified locally on July 14, 2026; the exact pushed release commit must repeat these gates in GitHub Actions:

- formatting and lint;
- Svelte and TypeScript checks with zero diagnostics;
- 415 unit tests across 66 files;
- production static build, initial-load budgets, and deployment-contract validation;
- 55 Chromium end-to-end workflows;
- the core create → Mash → export → import flow in Firefox and WebKit;
- a controlled service worker reopening the built static app and a locally created note offline;
- full npm dependency audit with zero known vulnerabilities.

## Stop-ship gates

| Gate                       | Required evidence                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Clean install              | `npm ci` succeeds on Node 22 from the lockfile.                                                                           |
| Static analysis            | `npm run lint` and `npm run check` pass with no ignored release errors.                                                   |
| Persistence and transforms | `npm test` passes, including compatibility, limits, lifecycle, recovery, and synchronization tests.                       |
| Deployable artifact        | `npm run build` writes `build/`; `npm run perf:budget` passes.                                                            |
| Deployment contract        | `npm run check:deploy` verifies Vercel, portable-host headers, SPA fallback, caching, and generated CSP.                  |
| Primary browser workflows  | `npm run test:e2e` passes in Chromium against the static `build/` artifact.                                               |
| Browser portability        | `npm run test:e2e:cross-browser` passes in Firefox and WebKit.                                                            |
| Offline contract           | The offline PWA test proves an active controlling worker, removes the network, reloads, and reads a locally created note. |
| Dependency security        | `npm run audit:security` reports no known high-severity vulnerabilities.                                                  |
| Release publication        | The `v1.0.0` tag matches `package.json`, points to a green `main` commit, and publishes the static zip plus `SHA256SUMS`. |

`npm run ci` is the local aggregate gate, including the dependency audit. The tag workflow installs all three Playwright browser engines and runs that same aggregate gate before it can publish a release.

## Stable V1 contract

V1 promises:

- no account, application backend, analytics, remote URL scraping, or hidden note upload;
- bounded and validated file, image, archive, markup, and portable-bundle intake;
- browser-local desks with explicit scratch, kept, recovery, and backup behavior;
- reversible manipulation where Mash presents an operation as reversible;
- a useful export path when browser persistence is unhealthy;
- a static build that can reopen previously cached core workflows offline;
- documented compatibility for supported desk and workspace bundle versions.

V1 does not promise cloud synchronization, collaboration, permanent browser storage, support for obsolete browsers, or recovery after a browser profile or device is deleted. Those boundaries remain visible in the public documentation and product UI.

## Release procedure

1. Merge the candidate through a pull request with CI and CodeQL green.
2. Confirm `package.json`, `package-lock.json`, and `CHANGELOG.md` all name `1.0.0`.
3. Replace `Unreleased` in the changelog with the release date.
4. Deploy that exact commit to a Vercel Preview and complete the response-header, offline, backup, and browser smoke checks in `docs/deployment.md`.
5. Promote the verified Preview artifact to the permanent production origin and repeat the header smoke check.
6. Create and push an annotated `v1.0.0` tag from the verified `main` commit.
7. Confirm the release workflow publishes `mash-static-v1.0.0.zip` and `SHA256SUMS`.
8. Download the release zip, verify its checksum, serve it from a secure static origin with the included headers, and run the browser-support smoke flow once against the published artifact.

Any failure reopens the candidate. Do not bypass a red gate to publish a stable tag.

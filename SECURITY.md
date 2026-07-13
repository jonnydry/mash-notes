# Security policy

Mash is a static, local-first web application that accepts untrusted text, archives, documents, images, URLs, and portable data bundles. File parsing, browser storage, export behavior, and content rendering are treated as security-sensitive surfaces.

## Supported versions

| Version          | Supported |
| ---------------- | --------- |
| `main`           | Yes       |
| `0.2.x`          | Yes       |
| Earlier versions | No        |

Until the first stable release, fixes land on `main` and the most recent tagged minor release.

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use **Security → Report a vulnerability** on the GitHub repository to submit a private report. Include:

- the affected version or commit;
- the browser and operating system;
- the smallest safe reproduction you can provide;
- the expected impact;
- whether the issue requires opening a crafted file or importing a bundle.

Do not include private notes, documents, credentials, or other sensitive source material. Use synthetic fixtures whenever possible.

You should receive an acknowledgement within 7 days. Confirmed issues will be triaged by severity, fixed privately when appropriate, and disclosed after a patched release is available.

## Security boundary

Mash does not provide isolation from other code already running with access to the same browser profile or device account. It also cannot prevent a browser, operating system, extension, or static host from observing normal application traffic.

Mash's application-level security goals are:

- do not send note or file contents to an application backend;
- render imported content without executing its scripts or active markup;
- reject unsupported, malformed, or excessively large imports;
- keep destructive workspace actions explicit and recoverable where promised;
- preserve an export path when browser persistence fails;
- ship restrictive production security headers and a Content Security Policy.

See [Privacy and storage](docs/privacy-and-storage.md) for the data model and trust assumptions.

# Deployment

Mash is a static, local-first PWA. A deployment serves application assets; it does not receive or
process note bodies, imported files, or workspace backups.

## Release invariant

Deploy only an exact commit that passes `npm run ci` and CodeQL. The repository-owned deployment
contract is:

- `vercel.json` for Vercel output, SPA fallback, response headers, and cache behavior;
- `static/_headers` for portable static hosts that support `_headers` files;
- SvelteKit's generated hash-based meta CSP for application scripts and content;
- `npm run check:deploy` to verify that those layers agree with the generated `build/` artifact.

The Vercel build command runs the deployment check after producing `build/`. A configuration drift
therefore fails the deployment instead of silently publishing weaker headers.

## Preview checklist

1. Deploy the candidate as a Vercel Preview from the exact reviewed commit.
2. Use synthetic content on the preview. Browser data belongs to the exact origin and will not move
   automatically from a preview URL to the production domain.
3. Run the smoke flow in `docs/browser-support.md`.
4. Confirm that an existing local note reopens after reload and after an offline reload once the
   service worker controls the page.
5. Inspect the root document, service worker, and one hashed asset:

```bash
curl -sS -D - -o /dev/null "$PREVIEW_URL/"
curl -sS -D - -o /dev/null "$PREVIEW_URL/sw.js"
curl -sS -D - -o /dev/null "$PREVIEW_URL/_app/immutable/<asset>"
```

The root response must include CSP framing protection, `X-Frame-Options: DENY`, `nosniff`, the
referrer, opener, resource, and permissions policies, plus a revalidating cache policy. `sw.js` must
also include `Service-Worker-Allowed: /`. Hashed `_app/immutable/` assets must be immutable for one
year.

## Production promotion

Choose the permanent public domain before asking people to store real work. Promote the already
verified Preview artifact rather than rebuilding a different artifact for production. After
promotion:

1. repeat the header checks against the production domain;
2. run one clean-profile browser smoke flow;
3. create and restore a synthetic workspace backup;
4. verify installability and offline reopening;
5. retain the previous deployment as the immediate rollback target.

If a production regression appears, roll back the deployment first. Browser-local user data remains
on the origin and should not be migrated or rewritten as part of an application rollback.

## Origin and data continuity

IndexedDB, local storage, service workers, and caches are scoped to the exact scheme, hostname, and
port. Moving between a Vercel Preview URL, a `vercel.app` production URL, and a custom domain creates
separate browser workspaces. Before changing a public origin, tell users to create a workspace backup
and keep the old origin available long enough to export it.

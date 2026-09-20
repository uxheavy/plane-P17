# Web App Map

## Scope

`apps/web` is the embedded Plane web client. It renders the product's user-facing
identity (browser title, PWA metadata, logo, activity-actor names) and reaches the
API through a proxy rather than a direct origin.

## Where Truth Lives

- Product identity values (title, description, keywords, URL, system-actor name):
  `@plane/constants` → [`packages/constants/src/metadata.ts`](../../packages/constants/src/metadata.ts).
  Import them; do not hardcode the product name in a component.
- What the product is called, and which `Plane` strings name the embedded
  upstream instead: [`../../../docs/decisions/0005-product-identity-company-runner.md`](../../../docs/decisions/0005-product-identity-company-runner.md)
- Client configuration and its documented defaults: [`.env.schema`](.env.schema),
  resolved by the development lifecycle (ADR-0011), not read as a hand-edited file.

## Local Gotchas

- **Leave every `VITE_*_BASE_URL` empty.** The Vite dev server proxies `/api`,
  `/auth`, `/static`, `/uploads`, and `/live` to `DEV_BACKEND_URL`, and the release
  stack fronts both services with a proxy. An absolute origin makes requests
  cross-origin, which fails unless the API's `CORS_ALLOWED_ORIGINS` also names that
  port. Empty means same-origin and is correct in both configurations.
- **Product-name changes do not appear until `@plane/constants` is rebuilt.** The
  app imports the package's built `dist`, so a `metadata.ts` edit is invisible until
  the package rebuilds and the web service restarts. See
  [`packages/constants/AGENTS.md`](../../packages/constants/AGENTS.md).
- The system-actor name is one constant, not a literal. Several activity surfaces
  (archive author, intake creator, inbox avatar) resolve to it, so a hardcoded
  product name drifts from the rest of the interface.
- `page-title.tsx` and `app/root.tsx` are the browser-title owners. Both read the
  shared constant; do not reintroduce a local title literal.

## Canonical Commands

This app adds no commands of its own. Use the web test commands in
[`../../AGENTS.md`](../../AGENTS.md).

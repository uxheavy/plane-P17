# Constants Package Map

## Scope

`packages/constants` owns the values every Plane app imports: product identity
and metadata, API endpoint paths, payment plan definitions, and shared enums.
Apps consume the **built** `dist`, never `src`.

## Where Truth Lives

- Product identity (name, title, description, keywords, URL, system-actor name):
  [`src/metadata.ts`](src/metadata.ts). This is the single owner for product-name
  surfaces; do not spell the product name into another app or component.
- What the product name must be, and which remaining `Plane` strings are upstream:
  [`../../../docs/decisions/0005-product-identity-company-runner.md`](../../../docs/decisions/0005-product-identity-company-runner.md)

## Local Gotchas

- **Editing `src/` changes nothing until `dist` is rebuilt.** `package.json`
  `main`, `module`, and `exports` all point at `./dist/index.mjs`, and `dist` is
  gitignored. A consumer reads the built artifact, so a correct source edit is
  invisible until it is rebuilt. Rebuild with `pnpm build` (or `npx tsdown`), then
  confirm the value actually landed in `dist/index.mjs`.
- **`turbo run dev` builds this package only at container start.** Restarting the
  web service is not enough to pick up a source-only change made afterwards.
- **The dev web container reaches this package through a bind mount.** If the
  running stack renders an older value than `src/` holds, verify the value inside
  the container rather than only on the host, then recreate the service.
- `SPACE_*` metadata describes the separate Publish surface. Check whether a
  consumer exists before assuming a value here is reachable from an app.

## Canonical Commands

The ancestor's filtered-turbo form applies; what this package adds is which task
to run after a source edit. Run from the `plane` repository root:

```bash
pnpm --filter @plane/constants build      # required before a src edit is visible
pnpm --filter @plane/constants check:types
```

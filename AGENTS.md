# Agent Development Guide

## Commands

- `pnpm dev` - Start all dev servers (web:3000, admin:3001)
- `pnpm build` - Build all packages and apps
- `pnpm check` - Run all checks (format, lint, types)
- `pnpm check:lint` - OxLint across all packages
- `pnpm check:types` - TypeScript type checking
- `pnpm fix` - Auto-fix format and lint issues
- `pnpm turbo run <command> --filter=<package>` - Target specific package/app
- `pnpm --filter=@plane/ui storybook` - Start Storybook on port 6006

## Code Style

- **Imports**: Use `workspace:*` for internal packages, `catalog:` for external deps
- **TypeScript**: Strict mode enabled, all files must be typed
- **Formatting**: oxfmt, run `pnpm fix:format`
- **Linting**: OxLint with shared `.oxlintrc.json` config
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Error Handling**: Use try-catch with proper error types, log errors appropriately
- **State Management**: MobX stores in `packages/shared-state`, reactive patterns
- **Testing**: All features require unit tests, use existing test framework per package
- **Components**: Build in `@plane/ui` with Storybook for isolated development

## Web tests

Frontend tests for `apps/web` live under `apps/web/tests` and mirror the source path beneath `apps/web`. Keep production helpers beside their owning source when they are not reusable application primitives.

Reference-consumer scenarios live under `apps/web/tests/reference` and exercise production entry points through deterministic representative stores or services.

- Run all web tests: `pnpm --filter=web test`
- Run web reference tests: `pnpm --filter=web test:reference`
- Run one web test: `pnpm --filter=web test -- <path-under-apps/web>`

## Feature shape acceptance

- Green behavior, tests, and builds are necessary but not sufficient for a new
  feature or material restructuring. Before handoff, inspect the actual source
  owner and at least one adjacent Plane precedent for placement, naming, and
  dependency direction.
- Keep refining the affected feature until the diff introduces no known
  structural debt: reusable names describe durable Plane capabilities, each
  module has one coherent reason to change, route-facing interfaces stay small,
  and vague helpers or pass-through modules do not hide ownership.
- Split only when the implementation demonstrates distinct stable owners. Do
  not split a cohesive module to meet a line-count target, invent speculative
  layers, or refactor unrelated legacy code in pursuit of an abstract ideal.
- A nested `AGENTS.md` is navigation only. Treat it as effective only when it
  exists, and verify its owner pointers against the current source before
  relying on them.

## Backend tests (Docker)

The Django/pytest suite for `apps/api` runs in an isolated stack defined by `docker-compose-test.yml` at the repo root.

Prereq (once): `./setup.sh` — generates `apps/api/.env` from `.env.example`.

- Full suite: `docker compose -f docker-compose-test.yml up --build --abort-on-container-exit --exit-code-from api-tests`
- Subset: `docker compose -f docker-compose-test.yml run --rm api-tests pytest -m unit`
- Teardown: `docker compose -f docker-compose-test.yml down -v`

See `apps/api/tests/RUNNING_TESTS.md` for the full walkthrough and troubleshooting; see `apps/api/tests/TESTING_GUIDE.md` for test conventions and fixtures.

## Effect v4 migration

- Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and follow its required links. Resolve API questions against `node_modules/effect/src`, matching the installed version.

- Use Effect's canonical `MIGRATION.md`, `migration/v3-to-v4.md`, and linked per-topic guides for API mappings; confirm replacements against v4 source signatures.
- Keep `effect` and every remaining `@effect/*` dependency on one exact v4 beta; `@effect/platform` APIs are consolidated into `effect`, while platform-specific packages remain separate.
- Resolve migration errors at their call sites; do not add v3 compatibility layers or casts that hide type errors.

## Work Map ownership map

Keep this boundary DRY: each concern has one canonical owner, and this file
only routes readers. The [Work Map decision records](docs/decisions/) are
revisable rationale; they are not UX or release proof. If current source or
evidence disproves a decision, revisit the decision and owner before adding a
second seam. Executable invariants belong in the listed owners and their
tests; this map is advisory guidance.

- **Plane source records, authorization, and source actions:** native Plane
  models plus the per-source [issue views](apps/api/plane/app/views/issue/)
  and [page views](apps/api/plane/app/views/page/), with the Work Map read gate
  in [`work_map.py`](apps/api/plane/app/permissions/work_map.py). Source
  discovery and readback live in
  [`work_map_source.py`](apps/api/plane/app/views/work_map_source.py). Work
  Map bindings keep opaque references and do not copy source state or own
  source mutations.
- **Document lifecycle:** [`document.py`](apps/api/plane/db/models/document.py),
  [`document.py`](apps/api/plane/app/permissions/document.py), and Work Map
  lifecycle views in [`work_map/base.py`](apps/api/plane/app/views/work_map/base.py),
  with the web list/detail state and API adapter in
  [`work-map.store.ts`](apps/web/core/store/work-map.store.ts) and
  [`work-map.service.ts`](apps/web/core/services/work-map.service.ts).
- **Work Map scene and protected bindings:** the backend model in
  [`work_map.py`](apps/api/plane/db/models/work_map.py), the scene/binding
  endpoints in [`apps/api/plane/app/views/work_map/`](apps/api/plane/app/views/work_map/),
  and the web editor in
  [`apps/web/core/components/work-maps/editor/`](apps/web/core/components/work-maps/editor/).
- **Read-only source hydration:** the API read projection and authorization
  above, [`work-map.store.ts`](apps/web/core/store/work-map.store.ts), and
  [`source-node.tsx`](apps/web/core/components/work-maps/source-node.tsx).
  Hydration is a viewer projection; it is not a second source record or a
  source mutation path.
- **Excalidraw scene arrangement and history:** the sibling
  `excalidraw-work-map` checkout's public host contract in
  `packages/excalidraw/{types.ts,index.tsx,components/App.tsx}`. Plane owns
  domain projections and policy, while the editor owns native scene behavior.
- **Realtime relay:** [`work-map-relay.ts`](apps/live/src/services/work-map-relay.ts),
  its Work Map service, and [`server.ts`](apps/live/src/server.ts) own the
  authenticated transport/session relay, not durable Plane source data.
- **Acceptance provisioning, receipts, and cleanup:** the external Plane
  Runner's `tests/acceptance/runner/` lifecycle. Keep that lifecycle out of
  product repos.

Current source carriers are ordinary Excalidraw rectangles with an opaque
`customData.nodeKey`. Plane renders their cards through `renderHostElement`,
whose host containers currently have `pointer-events: none`. Keep interaction
at this shared host/editor seam and reuse its existing selection and hit
testing behavior before introducing per-source event or geometry code.

## Work Map verification map

Use the existing package commands for focused proof:

- Web: `pnpm --filter web test -- <focused Work Map test paths>` (the web
  package's canonical script is `vitest run`).
- API: `docker compose -f docker-compose-test.yml run --rm api-tests pytest <focused Work Map test path>`.
- Excalidraw sibling: `yarn test:app --run <focused test paths>`.
- Documentation-only edits: `git diff --check`.

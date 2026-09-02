# ADR-0002: Share Document lifecycle between Pages and Work Maps

## Status

Accepted

## Date

2026-09-02

## Context

`Page` currently owns both reusable document lifecycle and rich-text-specific
state in `apps/api/plane/db/models/page.py`. `ProjectPage` owns active project
associations and `PageVersion` owns Page snapshots. Page APIs, permissions,
favorites, recents, search, assets, web stores, and `project_page` realtime
locators all depend on the existing Page UUID and project-scoped behavior.

Work Map needs the same owner, access, project, archive, lock, duplication,
discovery, and version lifecycle but a flat Excalidraw content engine. Copying
those fields would create two policies; adding spatial nullable fields to Page
would make Page the accidental owner of every document engine. Retrofitting a
shared identity is expensive to reverse because existing Page identity and
consumer contracts must not move.

## Decision

Introduce one durable **Document** identity for concerns genuinely shared by
Pages and Work Maps. `Page` and `WorkMap` are sibling Document subtypes and use
the same immutable UUID as their Document identity.

Document is the sole final owner of:

- workspace, owner, access, creator/editor attribution, and timestamps;
- active and soft-deleted project associations;
- archive, lock, ordering, and shared lifecycle metadata;
- favorites, recents, metadata search identity, and collaboration identity; and
- version identity and lifecycle.

Subtype owners remain narrow:

- Page owns rich-text content, labels and rich-text transactions, and its
  parent-child hierarchy.
- Work Map owns exact collaborative scene content and the protected node-binding
  set described by ADR-0003.
- PageVersion owns Page-specific rich-text snapshot payload.
- WorkMapVersion owns exact Work Map scene content and a protected binding
  snapshot. One Document version identifies both parts; they restore atomically.

Plane's existing asset system remains the authority for file bytes and access.
`FileAsset.document` is the shared owner link for current Page and Work Map
assets. Work Map collaborative content stores only opaque `FileAsset` IDs and
the Excalidraw file metadata needed to render them. It never stores asset bytes,
`dataURL` values, signed download URLs, or credentials in the scene or relay.
Materialized browser files are viewer-local and disposable.

`DocumentVersionAsset` is the single reachability record between a retained
Document version and every `FileAsset` required by that version. It does not
copy bytes. Resolving a historical asset always rechecks the viewer's current
Document/project permission, so retaining a version neither makes an asset
public nor creates another access owner. Page version callers migrate to the
same link without changing Page IDs, routes, payloads, or asset behavior.

This decision does not create a generic content-adapter registry. Shared
lifecycle is one concrete owner; Page and Work Map content remain a closed
two-case dispatch where dispatch is necessary.

### Page compatibility boundary

Migration must preserve, without translation visible to consumers:

- every Page UUID;
- every Page project route and supported API payload/behavior;
- current public/private and owner permission outcomes;
- Page hierarchy, labels, transactions, assets, versions, and project links;
- favorites, recents, and search behavior; and
- the existing `project_page` realtime locator and rich-text editor behavior.

Internal model names and joins are not compatibility APIs. All internal callers
must migrate to Document ownership so the final state has one lifecycle owner.
There is no permanent legacy/replacement pair and no permanent dual write.

Migration may temporarily retain legacy storage for compatibility and rollback,
but after ownership cutover Document is the only application write authority.
Before destructive contraction, compatibility proof must compare identities,
shared field values, active and soft-deleted associations, favorite and recent
targets, version and asset resolution, API behavior, and realtime behavior; the
old path must still be restorable without translating identities. Destructive
contraction occurs only after that proof and its rollback window. Beyond that
boundary, recovery is forward repair or database restore, never renewed dual
ownership. The migration is incomplete until transitional storage and callers
are removed and invariants prove one owner.

The approved final cutover is destructive only after that caller proof and
rollback window. It removes shared lifecycle columns from `Page`, retires
`ProjectPage` as the association owner, and removes shared version identity,
lifecycle, and asset ownership from `PageVersion`. It also removes legacy
`FileAsset.page` lifecycle ownership: a temporarily retained Page API pointer
must use `SET_NULL` and is non-authoritative, never cascading. Retaining its
cascading delete would leave Page as a second asset-lifecycle owner after the
cutover. `Page` and `PageVersion` remain as rich-text subtype owners on the same
preserved IDs; `Document`, Document project associations, Document versions, and
`DocumentVersionAsset` are their sole shared owners. The contraction is not
optional compatibility debt and does not create ID translation or a replacement
Page route.

### Shared lifecycle semantics

Page behavior is the source of truth:

- creation occurs in a current project and creates at least one active project
  association;
- a direct association update cannot remove the final active association;
- `PUBLIC` is readable only through an active associated project in which the
  viewer is an active member;
- `PRIVATE` retains the Page owner rule inside that project boundary;
- archive, lock, ordering, owner changes, favorites, recents, versions, and
  duplication follow current Page outcomes;
- project lists include only active associations in that project; and
- global discovery resolves through an active associated project the viewer may
  access.

Current Page project-deletion behavior is preserved: deleting a project removes
its document association but does not delete the document, including when that
was the final active association. Such a Work Map remains durable but is
unreachable through V0 routes. This is the sole approved exception to the
normal final-association invariant. V0 adds no recovery route to compensate.

Lock, archive, insufficient map permission, and realtime disconnection prevent
Work Map-owned mutations. They do not suppress a canonical source action that
the source entity independently authorizes.

### Duplication and versions

Duplicating a Work Map is one aggregate operation. It creates a new Document
and Work Map identity, copies every referenced asset to a target-owned
`FileAsset` and storage key, rewrites the copied scene to those asset IDs while
preserving Excalidraw file IDs and structure, issues target-map-owned opaque
binding keys for the same authoritative sources, and applies Page
duplication defaults for owner, access, and projects. Source access is evaluated
again for every viewer of the duplicate. The operation exposes one complete
duplicate or no duplicate; a partial scene, binding set, or asset copy is never
visible. Failed storage copies are compensated before failure when storage
permits it. If compensation itself fails, the request still exposes no
duplicate and retains the `WorkMapDuplicateOperation` receipt and lease state
needed to retry idempotent cleanup; it never discards the only owner of copied
objects.

Version restoration follows the Page product experience: the selected version
becomes current content through the live editor and later history remains
available. Work Map scene and protected binding snapshot become current in one
transaction and one new generation. The restored scene reuses the retained
`DocumentVersionAsset` references rather than copying bytes. A client can never
observe a restored scene paired with bindings or assets from another version.
Restore failure leaves the prior scene, binding set, generation, current asset
reachability, and historical asset reachability unchanged.

### Durable multi-step operations

The database transaction remains the visibility boundary, but uploads, object
copies, and client-mediated carrier insertion can cross that boundary. V0
therefore adds four narrow operation owners instead of a generic job or workflow
registry:

- `WorkMapBindingPlacement` owns one newly created binding until its native
  carrier is durably inserted or the placement is cancelled;
- `WorkMapSceneAssetPlacement` owns one newly uploaded Work Map asset until a
  durable scene generation references it or the placement is cancelled;
- `WorkMapPasteRebinding` owns the complete source-to-target key replacement for
  one cross-map paste before any pasted element enters the target scene; and
- `WorkMapDuplicateOperation` owns one whole-map duplicate, including its target
  Document, scene, bindings, assets, and version reachability.

Each operation has one accountable owner, an idempotency identity, a renewable
bounded lease, explicit terminal state, and enough receipts to retry or clean up
only the resources it created. A claimant may resume an expired lease but may
not steal an active one. Success becomes visible once; failure and lease-expiry
cleanup are idempotent. Crash recovery removes orphan binding placements,
finalized-but-unreferenced Work Map uploads, incomplete paste rebinding, staged
object copies, and incomplete duplicate aggregates without touching
pre-existing resources. These records are not a second scene, binding, asset,
or workflow authority and are retained only for the bounded recovery window
required to prove cleanup.

Work Map V0 adds no activity/compliance subsystem. Creator, last editor,
timestamps, and versions provide document-state attribution. Presence, cursors,
raw scene mutations, hydration, iframe interaction, and source edits do not
create Work Map activity records. Source edits retain source-owned history.

### V1 decision horizon

V1 reserves semantic mentions from Work Maps. Ordinary `@name` canvas text
remains non-semantic until an explicit interaction and notification lifecycle is
decided.

Durable document-level or spatially anchored comments remain deferred until
their ownership, lifecycle, permissions, version interaction, and notification
contract is decided. A future activity or compliance requirement must likewise
define audience, event coverage, retention, and integrity before adding storage
or logging infrastructure.

## Migration invariants and proof

- A Page and its new Document must have identical IDs; no redirect or ID map is
  acceptable.
- Backfill must be retry-safe and preserve active and deleted associations and
  version IDs.
- Before ownership cutover, counts, IDs, lifecycle fields, project associations,
  hierarchy, assets, versions, permissions, API results, and realtime attachment
  behavior must compare equal on production-shaped data.
- Forward and pre-contraction rollback paths must be executable. Post-contraction
  recovery must not recreate a second owner. A migration that requires permanent
  dual writes or changes a Page consumer contract fails.
- Contract tests must include wrong-project, inactive-link, private/public,
  archive/lock, duplicate, version, project-deletion, asset, search, favorite,
  recent, and realtime cases.

## Alternatives considered

### Keep unrelated Page and Work Map lifecycle models

Rejected because shared rules would drift and every future lifecycle change
would need two security reviews.

### Add Work Map fields to Page

Rejected because Page hierarchy and rich-text state would become the schema and
vocabulary for another engine.

### Permanent compatibility facade or dual writes

Rejected because it leaves two authorities and makes drift a steady-state
condition rather than a bounded migration risk.

## Consequences

- Page migration is a release-critical compatibility operation.
- Shared Document queries replace Page-specific lifecycle joins over time, while
  Page content remains Page-specific.
- A document may be durable but unreachable after deletion of its final project,
  matching current Page semantics.
- Work Map version and duplication operations must coordinate scene, bindings,
  assets, and generation as one aggregate.

# ADR-0006: Require layered reference-application acceptance for Work Map V0

## Status

Accepted

## Date

2026-09-02

## Context

Work Map crosses Django lifecycle and permissions, Plane entity owners, browser
interaction, Excalidraw native behavior, Plane Live transient delivery, API
compare-and-swap durability, assets, untrusted iframes, and an external
acceptance consumer. Unit tests alone cannot prove experienced correctness,
while a hand-built demo cannot prove repeatability, isolation, authorization,
or cleanup.

Plane already has backend contract, live, web, and browser-test seams. The
external Plane Runner repository owns reusable acceptance lifecycle and
case-owned fixtures. Duplicating provisioning and login inside product code or
putting BookNow values into shared tests would create another owner.

The expensive decision is what evidence is mandatory to release and who owns
that evidence lifecycle.

## Decision

Work Map V0 requires layered proof:

1. focused unit tests for deterministic local logic;
2. backend/live/web contract tests for authority and integration boundaries;
3. the exact-package realtime/carrier/clipboard gate in ADR-0004;
4. real desktop and tablet outside-in journeys through signed-in Plane; and
5. a bounded human review of the exact automated state.

Passing a lower layer never substitutes for a higher layer whose risk it cannot
observe. Evidence proves only the exercised scenarios and supported envelope.

### Ownership boundary

Plane owns product behavior, product-side assertions, stable test entry points,
and semantic readback. The external acceptance consumer owns:

- run identity and atomic ownership claims for mutable resources;
- pinned Plane, runner, browser, and Excalidraw artifact inputs;
- dynamic allocation and receipt-backed ownership of ports, processes,
  containers, databases, browser profiles, and temporary paths;
- deterministic identity/data provisioning from case-owned fixtures;
- real sign-in handoff and browser orchestration;
- receipts, evidence paths, retention/expiry, and cleanup; and
- case data such as BookNow actors, projects, work items, and expected visible
  observations.

The interface is a versioned provisioning/review receipt, not an assumed folder
layout, pre-existing database, shared account, or copied runner. At minimum it
identifies contract version, run ID, exact Plane and runner revisions, exact
Excalidraw fork/base and packaging-merge commits, immutable package artifact
URLs, SHA-256/SHA-512/integrity values, resolved lockfile entries, application
URL, safe actor-auth handoff,
workspace/project/map/source handles, inspection targets, evidence location,
expiry, and cleanup invocation.

Reusable Plane code, tests, routes, schemas, and ADR vocabulary remain neutral.
BookNow is one explicit case fixture and may be replaced by another case without
copying login, bootstrap, receipts, retention, or cleanup.

The selected Excalidraw receipt must resolve the public release
`https://github.com/uxheavy/excalidraw-P17/releases/tag/packages-v0.18.0-583b3c3c`
and match every digest recorded in ADR-0004. A local tarball with the same name
but different provenance or bytes fails the gate.

### Acceptance lifecycle invariants

Every reference run is self-bootstrapping and reproducible. It is called
hermetic only when every dependency and input is controlled. Each run is:

- self-provisioning from version-controlled schema-validated inputs;
- deterministic where observable behavior is controllable;
- namespaced and atomically claimed so it never steals shared ports, processes,
  databases, browser profiles, or accounts;
- dynamically allocated from available resources rather than assuming fixed
  ports, compose names, database names, or browser profiles;
- idempotent and safe to retry;
- independent of pre-existing Plane records or manual setup; and
- cleanable by an idempotent command that refuses resources not owned by its run
  receipt.

The ownership receipt inventories every mutable process, port or lease,
container or compose namespace, database-record namespace, browser profile,
temporary path, and retained artifact it owns. Cleanup refuses anything absent
from that receipt.

CI and unattended runs clean up on success and failure. Explicit local review
mode retains the exact automated state for a bounded window and emits directly:
application URL, reference identity, safe authentication method, run ID,
ordered sign-in/navigation steps, visible states to inspect, expected result,
expiry, and idempotent cleanup command. A separate hand-built demo account does
not satisfy this requirement. No production-capable secret is committed.

### Mandatory falsifiable proof

#### Page/Document compatibility

On production-shaped data, prove Page ID, project route, supported API,
permission, project association, hierarchy, asset, favorite, recent, search,
version, and `project_page` realtime behavior before and after migration. Prove
forward and rollback invariants and removal of permanent dual ownership,
including the legacy `FileAsset.page` cascade before destructive contraction.

#### Authority and disclosure

With users holding different map/source/project permissions, inspect API, DOM,
clipboard, raw collaborative scene, and socket payloads. Prove source metadata
is absent when unauthorized, tombstones are non-disclosing, every attachment
reauthorizes, read-only cannot mutate, and permission/generation changes close
stale writers.

While a connected focused map remains open, revoke one source permission. Prove
the affected cached card becomes the uniform tombstone, protected metadata
disappears, unrelated nodes remain usable, and the result creates no promise of
instantaneous business-data freshness before durable invalidation delivery.

Prove source mutation and `WorkMapProjectionInvalidation` creation are one
transaction, failed or ambiguous delivery remains pending, successful delivery
marks the record delivered with its publication receipt, later cleanup removes
only eligible delivered records, browser publication is rejected, and the client
tombstones before rehydration. Hydrate opaque keys independently at concurrency
eight and prove a slow, denied, or failed key does not block or disclose another
key.

#### Two-client convergence and persistence

Under deterministic delivery, prove the selected ADR-0004 path: full scenes are
restored, reconciled, and applied with `CaptureUpdateAction.NEVER`; independent
and conflicting edits converge with valid arrows, groups, and ordering; remote
changes remain absent from local Undo; and the 20-second full-scene broadcast
repairs a dropped transient frame. Prove the API compare-and-swap, not relay
receipt, is the durability acknowledgement and survives API, Live, Redis, and
browser restart. Prove atomic version restore with matching protected bindings
and retained asset reachability. Prove normal CAS changes generation without
changing `collaboration_epoch`; restore and lifecycle resets advance the epoch,
publish immediate force-close, and periodic epoch/authorization checks close a
client when that Redis control message is deliberately dropped.

#### Document-owned asset journey

Through real desktop and tablet editors, insert an image and prove its bytes are
uploaded to a `FileAsset` owned by the Work Map's Document before the scene is
durable. Inspect the stored scene, API payloads, relay frames, browser storage,
and logs: they may contain only the opaque Plane asset ID and Excalidraw file
metadata, never `dataURL` bytes, signed URLs, credentials, or protected storage
keys. Reload and restart all product services, then prove the authorized viewer
can materialize the same bytes while a denied viewer receives neither bytes nor
metadata.

Create and restore a retained version, then prove `DocumentVersionAsset` keeps
the required asset reachable without copying bytes and still enforces current
Document permission. Duplicate the whole Work Map and prove the copy has a new
target-owned `FileAsset` ID and storage key with byte-identical content, while
the copied scene preserves Excalidraw file IDs and structure and bindings use
fresh target-owned keys. Inject a storage-copy failure and prove no target
Document, Work Map, scene, binding, version-asset link, or asset row becomes
visible and any staged object is removed.

Interrupt native image insertion after upload finalization but before the scene
save. Prove the expired `WorkMapSceneAssetPlacement` removes only that
finalized-but-unreferenced asset and storage object. Prove a placement referenced
by a durable scene generation is committed and never reclaimed.

#### Native carrier and clipboard

Using real Plane presentations, prove selection, transform, grouping, ordering,
arrows at both endpoints, duplication, deletion, and undo. Prove Copy/Cut keep
opaque keys; same-map duplicate retains its key; cross-map paste and
whole-document duplicate allocate fresh target-owned keys while preserving
shared-binding topology; and paste replaces keys before insertion. Prove an
injected failure between binding and carrier insertion leaves no orphan binding,
retries are idempotent, and any unauthorized or unmaterializable mixed selection
produces no inserted subset or scene, binding, or asset change.

Kill the claimant at each external boundary of `WorkMapBindingPlacement`,
`WorkMapSceneAssetPlacement`, `WorkMapPasteRebinding`, and
`WorkMapDuplicateOperation`. Prove active leases cannot be stolen, expired
leases resume idempotently, committed results become visible once, and cleanup
removes only operation-owned bindings, uploaded assets, replacement keys, staged
objects, and incomplete aggregates.

#### Experienced desktop and tablet behavior

Through the real project Work Map routes and real sign-in, prove create/list/
open, native drawing, placement and canonical source action, hydration and
tombstones, disconnected/read-only state, recovery retry, URL-embed behavior,
duplicate, versions, lock/archive, search/favorite/recent, and project-scoped
denial. Tablet proof uses touch and no-hover affordances rather than a resized
desktop assertion.

Recovery proof covers HTTP durable-acknowledgement cleanup, explicit discard,
tab close, generation-mismatch rejection, and authority-revocation rejection,
without silent replay or document mutation. It proves there is at most one
`sessionStorage` record scoped by user, Work Map, and generation and no durable
awareness record. Awareness proof uses a 10-second heartbeat and 30-second lease
expiry keyed by connection ID, including two tabs for the same user.

#### Supported performance envelope

Use a deterministic representative map with up to 1,000 total Excalidraw
elements, 100 live Plane nodes, five URL embeds, and ten concurrent editors.
Scene and skeletons must render before hydration finishes; one delayed source
must not block other nodes or drawing, selection, pan, or zoom; clients must
converge and restart exactly.

The exact-package gate records a controlled baseline and commits reproducible
tolerances for interaction latency, long tasks, memory, and hydration before
release. A developer-laptop number or subjective “feels smooth” claim is not a
gate. V0 does not interpret the envelope as a hard limit for larger maps, but
makes no performance promise beyond it.

The runner pins the exact application, runner, browser, fixture, and package
inputs and records machine/runtime characteristics, raw measurements, declared
tolerances, and pass/fail calculations in the review receipt. Review mode
preserves the same measured post-scenario state and dynamically allocated
resources; the receipt gives their ownership, expiry, ordered inspection steps,
and cleanup command rather than asking the reviewer to reconstruct the run.

### Release scenario matrix

The matrix identifies experienced risks; lower-level tests may support a row but
cannot replace its outside-in result.

| Scenario | Actor | Accepted outcome | Dangerous outcome | Source of truth | Risk |
| --- | --- | --- | --- | --- | --- |
| Existing Page compatibility | Page owner and project member | Existing identity, routes, supported API, access, versions, assets, associations, discovery, and realtime locator remain stable through migration and rollback boundary | identity translation, route drift, cross-project read, lost state, or permanent dual ownership | current Page contracts and migrated Plane state | critical production regression |
| Desktop authoring and persistence | Work Map editor | Real native scene, all supported Plane-node kinds, assets, arrows, reload, and service restart preserve equivalent durable state | overlay-only behavior, session state, or restart drift | persisted scene, protected bindings, assets, and rendered scene | main V0 journey is false |
| Permission-aware loaded map | Authorized editor, authorized viewer, and source-denied viewer | Per-viewer projections differ without collaborative leakage; a denied attachment to an already-loaded room receives no content; active source revocation tombstones only the affected cached projection | map access grants source access, cached room bypass, stale protected metadata, or metadata oracle | current map/source permission owners and raw transport inspection | confidentiality breach |
| Realtime convergence and recovery | Two editors and one read-only viewer | Deterministic conflicts converge; remote edits stay out of local undo; API-acknowledged state survives restart; failure freezes and explicit retry reauthorizes; acknowledgement, discard, and tab close clear recovery while generation/authority rejection never replays | false durability, read-only write, silent replay, unbounded local recovery state, or stale-generation corruption | persisted scene, generation, tab-session record, and restart readback | document corruption |
| Document-owned asset lifecycle | Editor, authorized viewer, and denied viewer | Native insertion persists a Document-owned asset; reload and restart materialize it only for authorized viewers; versions retain reachability; duplicate creates a byte-identical target-owned copy; injected copy failure leaves no partial aggregate | bytes or signed URLs in scene/relay, unauthorized materialization, missing history, shared duplicate asset ownership, or orphan storage/database state | `FileAsset.document`, `DocumentVersionAsset`, object bytes, stored scene, and aggregate readback | confidentiality or durable data loss |
| Cross-map mixed paste | Target editor with allowed and denied source cases | Allowed paste preserves key-sharing topology, assets, and structure before one native insertion; denial, asset failure, placement failure, or cross-workspace input leaves scene, bindings, and assets unchanged | partial selection, old key, orphan binding, asset drift, broken structure, or leaked source | binding transaction, Plane asset owner, and final collaborative scene | authorization and data loss |
| Version restore and duplicate | Document owner | Scene, binding snapshot, generation, and asset references change atomically; duplicate is complete and independently authorized | mixed version state, missing historical asset, stale overwrite, or visible partial duplicate | Work Map aggregate and Plane asset owner | unrecoverable inconsistency |
| URL embed trust on desktop and tablet | Editor and read-only viewer | Controlled allowed, denied, and slow origins prove inert-first loading, shared document enablement, viewer-local load, origin reset, native pan/interaction, sandbox, and credential isolation | iframe steals gestures, viewer mutates document, sandbox weakens, credential leak, or canvas stall | collaborative node state, browser policy, and controlled local origins | third-party trust and gesture failure |
| Discovery and project lifecycle | Owner and members with different project access | Lists, search, favorite, and recent open through an accessible active project; Page-like lock/archive and final-link deletion behavior hold | unscoped access, ghost route, or Work Map-only lifecycle semantics | shared Document associations and current Page behavior | secondary access drift |
| Supported load envelope | Ten authenticated editors | A 1,000-element scene with 100 live nodes and five embeds remains interactive while hydration is independent and clients converge | hydration or embeds block drawing, crash clients, or prevent convergence | measured browser interaction and persisted final state | unusable supported scale |

### Release failure semantics

Any missing mandatory proof is reported as blocked, unavailable, skipped, or
timeout; it is not inferred from a green lower layer. If the exact fork artifact
cannot be reproduced, verified in a clean consumer, and resolved from Plane's
lockfile with matching provenance and digest, release stops. If outside-in or
performance proof fails, release also stops; the failure does not authorize
iframe virtualization, a second realtime path, a registry, or another
speculative subsystem without its own decision.

Each evidence set records its exact source revisions, run-owned-resource
receipt, structured assertions, durable readback, relevant browser trace or
screenshot, retention window, and cleanup result. Authentication and protected
source data are redacted.

## Alternatives considered

### Unit/integration tests only

Rejected because they cannot prove real canvas gestures, iframe interaction,
multi-client experience, or human-inspectable state.

### Manual demo as acceptance

Rejected because pre-existing state, hidden setup, and subjective observation
are not deterministic, retry-safe, or cleanable.

### Put the case fixture and lifecycle in Plane

Rejected because it duplicates the external runner owner and lets the first
company define reusable product vocabulary and defaults.

### Broad end-to-end matrix for every permutation

Rejected because it increases runtime and maintenance without stronger proof.
Use one representative main journey and the material trust/failure boundaries,
with table-driven lower-level authorization coverage.

## Consequences

- Production release depends on the external acceptance consumer contract as
  well as product code.
- Human inspection becomes repeatable and uses the automated state.
- Expensive multi-user/performance evidence may run outside every small PR but
  remains a release gate.
- Failed or missing proof narrows the completion claim rather than being hidden.

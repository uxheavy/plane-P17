# ADR-0003: Use closed protected live-node references in Work Maps

## Status

Accepted

## Date

2026-09-02

## Context

A Work Map viewer may read the map without permission to read every referenced
Plane entity. Collaborative scene bytes are delivered to every map viewer, so
placing source kinds, IDs, project IDs, titles, or hydrated state in Excalidraw
data would disclose metadata before the client could redact it.

The six V0 sources do not share one loader, feature flag, permission policy,
renderer, create flow, or open action. A general registry would claim a common
contract that current Plane code does not have. Conversely, six independent
integrations would repeat the same trust boundary and native-carrier rules.

Excalidraw `0.18.0` publicly exposes element `customData`, embeddable rendering,
and an awaited `onPaste`, but exact carrier and clipboard replacement behavior
remains an ADR-0004/0006 evidence gate rather than an assumption.

## Decision

Use a closed, exhaustively dispatched live-node model. The supported Plane
source kinds are:

- `work-item`, always available;
- `cycle`, when `cycle_view` is enabled;
- `module`, when `module_view` is enabled;
- `project-view`, when `issue_views_view` is enabled;
- `page`, when `page_view` is enabled; and
- `intake-item`, when backend `intake_view` / web `inbox_view` is enabled.

Feature availability is necessary but never sufficient. Existing source
membership and authorization govern discovery, binding, hydration, opening,
and editing. Work Map project associations do not restrict source discovery;
same-workspace scope and the source project rules do.

Do not add a runtime plugin registry, generic entity adapter, or Power K
dependency. Power K was only an interaction reference.

### State ownership and disclosure

| State | Owner and visibility |
| --- | --- |
| Geometry, selection, order, native bindings, canvas element ID | Excalidraw collaborative scene; visible to map viewers |
| Opaque globally unique `nodeKey` | Excalidraw carrier custom data; visible but non-authorizing |
| Source kind, source ID, and binding revision | Plane protected Work Map binding state; never collaborative content |
| Hydrated title, state, identifiers, actions, canonical project context | Viewer-scoped server response and viewer-scoped cache |
| Placement ghost and unresolved create/select state | Local ephemeral client state only |
| Presence, pointer, and selection | Realtime awareness; ephemeral |

A `nodeKey` locates a protected binding and grants no authority. The server
resolves it only after current map and source authorization. Missing, deleted,
denied, or feature-disabled sources hydrate as the same geometry-preserving,
metadata-free unavailable node. Neither status nor error text distinguishes
those causes.

Transient transport failure may retain a last successful projection only when
visibly marked stale with retry. It must not convert an authorization/deletion
result into stale visible metadata.

### Native carrier invariant

Each Plane projection uses one native bindable Excalidraw carrier. That carrier
is the sole owner of geometry, selection, hit testing, resize, rotation,
grouping, z-order, duplication, deletion, native arrow binding, and Excalidraw
history. Plane adds only `nodeKey`, viewer-authorized rendering, placement, and
the canonical source action.

Hidden mirror geometry, a second hit-test/transform system, Plane-owned arrows,
or a separate undo track fail this architecture. A Plane node must provide every
applicable behavior of its carrier plus Plane behavior, never less.

Work Item reuses the real `WorkItemPreviewCard`, extended only for responsive
container presentation while preserving its existing default. Presentation
responds to the actual content container, including sidebars and split layouts,
not only to viewport width. Other kinds
compose compact presentations from their existing Plane icons, identifiers,
status/progress primitives, typography, and cards; they do not mount route
controllers or full editors in the canvas. CSS container queries reflow or hide
secondary fields as bounds shrink; V0 adds no separate display-mode state or
ResizeObserver layout engine.

Primary click/tap selects and drag moves. Double-click, `Enter` on a selected
node, or a visible Open control invokes the canonical source action. Hover may
reveal Open on pointer devices; selection must reveal an equivalent on tablet.
Work Item and Page use centered modal peek where supported; Cycle and Module use
their existing peek; Project View and Intake use existing detail/navigation.
Source editing occurs there under source permissions, not inline in the card.
Cards expose no inline status, assignee, or action-menu mutation, and Work Map
has no persistent right-side inspector in V0.

### Placement and hydration

One placement controller owns tool activation, fixed-size ghost, click-to-place,
create-or-select, cancellation, and Excalidraw keep-tool-active behavior. `W`
activates Work Item; the other kinds occupy one feature/permission-filtered
dropdown beside it in the native Excalidraw toolbar.

Work Map owns these route-scoped shortcut overrides: `W` activates Work Item,
and `D`, `B`, or `X` activates native free drawing to preserve tldraw drawing
muscle memory. The overrides do not run while the user is typing or outside a
Work Map; normal Plane shortcuts remain unchanged. Native Excalidraw tools keep
their other shortcuts. Diamond remains available through its native toolbar
control and numeric shortcut, while Web Embed remains in the native More tools
menu as specified by ADR-0005.

At workspace scope, availability is the union of kinds enabled across projects
the viewer may access. Each chooser groups or filters results by source project
and omits projects where that kind's feature is disabled. Selection of an
existing source is always supported. `Create new`
appears only when Plane already has a canonical create flow and the viewer may
use it. Creating a Work Item retains the normal project picker.

No unresolved placeholder or source metadata enters collaborative state.
Binding succeeds first; then the carrier is inserted. The same source may have
multiple projections with independent canvas IDs and geometry. Native duplicate
inside one map creates a new canvas ID and retains the same `nodeKey` and
protected binding.

A failed or cancelled placement exposes neither a collaborative carrier nor a
live protected binding. Retrying the same in-flight placement is idempotent, and
cleanup must not delete a binding referenced by an acknowledged carrier.

Scene and skeletons render before hydration. The server batch-hydrates
viewer-scoped projections, with each source resolving independently. Revalidate
on open and browser focus/connectivity return; reuse same-client source-store
updates and provide manual stale retry. V0 promises no Work Map-specific polling
or continuous cross-client source-update stream.

An active session must also consume an authorization or source-invalidation
signal that causes affected viewer projections to reauthorize and fail closed.
The concrete delivery transport is an implementation investigation, not a new
source-of-truth. Until that seam is proved, V0 makes no promise of instantaneous
cross-client business-data freshness; every hydration and source action still
uses current authorization, and a known revocation immediately removes cached
metadata.

V1 may strengthen business-data freshness through a shared Plane entity-update
channel owned by the authoritative sources. V0 adds neither Work Map-specific
polling nor a second source of truth for entity updates.

Deleting a projection never deletes its source. Native arrows unbind according
to Excalidraw behavior; map Undo restores the projection and bindings. Map Undo
and Work Map versions never roll back source state.

### Cross-map clipboard

Native clipboard data carries the existing carrier plus its opaque `nodeKey`.
It never carries source Work Map, workspace/project identity, source kind/ID,
hydrated metadata, credential, or transfer token.

Before any pasted element enters collaborative state, one server operation:

1. verifies current target edit permission and target generation;
2. resolves every old binding;
3. applies current source-kind read policy and same-workspace scope;
4. authorizes and materializes any Plane-owned native assets needed by the
   selection;
5. resolves or creates target-map-owned bindings transactionally; and
6. returns replacement opaque keys for insertion.

For cross-map paste, each distinct copied source key maps to one target-map-owned
replacement key; repeated occurrences map consistently, and no source-map key
enters target collaborative state. A retry of the same in-flight paste returns
the same committed binding result and creates no duplicate target mutation. A
later intentional paste is a new native action whose new canvas elements may
share the target binding. A whole-document duplicate similarly assigns one fresh
target-map-owned key to each distinct source binding, rewrites every carrier
consistently, and preserves the source map's binding-sharing topology.

Any unavailable live source or required asset cancels the entire mixed
native/live selection with one non-disclosing error. Failure leaves target scene,
protected bindings, and target asset state unchanged. Success preserves arrows,
frames, groups, files, ordering, selection, and one native undo step. Native-only
paste bypasses rebinding.

The exact shipped package must prove that Copy/Cut preserve `nodeKey` and the
awaited host callback can replace keys before native insertion. If not, only the
smallest generic replacement-return contract may be added to Excalidraw. Do not
add a copy hook, Plane clipboard format, parallel insertion path, or
after-the-fact repair of an already collaborative paste.

## Verification obligations

- Raw persisted/realtime scene and clipboard inspection must contain no
  protected source identity or hydrated data.
- Table-driven source contracts must cover all six kinds, feature enabled and
  disabled, active and inactive membership, readable and denied source, deleted
  source, wrong workspace/project, and uniform tombstones.
- The exact carrier must pass native selection, move, resize, rotate, group,
  order, duplicate, delete, arrow binding from both endpoints, and undo on
  desktop and tablet.
- Hydration must remain independent under a deliberately slow source.
- Mixed paste must prove replacement-before-insertion, retry idempotency,
  same-key topology, structural and asset preservation, whole-selection
  cancellation, and no scene, binding, or asset mutation on denial.

## Alternatives considered

### Store source references in collaborative custom data

Rejected because every map viewer would receive protected metadata before
viewer-specific authorization.

### Runtime entity registry

Rejected because the six sources have not earned a smaller common contract.
Closed exhaustive dispatch makes missing authorization branches visible.

### Plane overlay with mirror geometry

Rejected because it creates a second spatial and interaction authority and
necessarily loses native behavior.

### Partial paste or degraded placeholders

Rejected because it silently corrupts a native selection's arrows, groups,
frames, files, ordering, and undo semantics.

## Consequences

- Protected bindings and viewer hydration are server responsibilities.
- Adding a node kind requires an explicit union, permission, presentation,
  action, and verification change; it does not justify a plugin system.
- Projection freshness is bounded in V0; current authorization always overrides
  cached presentation.
- Clipboard paste requires a network authorization round trip for live nodes.

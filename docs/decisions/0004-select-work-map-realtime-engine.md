# ADR-0004: Use Plane Live for Work Map realtime persistence

## Status

Accepted

## Date

2026-09-02

## Context

Plane already operates Yjs/Hocuspocus in `apps/live` with Redis coordination,
awareness, and database persistence for Pages. Current code supports only
`project_page`, converts persisted binary through Page rich-text formats, and
authenticates the user without authorizing the exact requested document before
attachment. Those Page-specific assumptions cannot be applied to a spatial
scene, and loaded Hocuspocus documents must not become authorization caches.

The installed Excalidraw version exposes whole-scene update and undo controls,
while the local newer Excalidraw checkout exposes StoreDelta APIs absent from
the shipped `0.18.0`. Selecting a scene encoding from the newer checkout or from
prose would be unsafe. The system boundary is durable; the encoding remains an
evidence-gated choice inside that boundary.

## Decision

`apps/live` is the sole Work Map realtime shell in V0. It uses a closed
`project_page | work_map` dispatch with separate content implementations.

- Page retains its existing locator, rich-text conversion, title sync, editor,
  and supported APIs.
- Work Map uses exact Work Map Yjs binary. It never runs Page serializers,
  HTML/JSON conversion, title observers, XML-fragment assumptions, or IndexedDB
  offline persistence.
- Hocuspocus owns authenticated transport and in-memory Yjs documents; Redis
  owns cross-instance updates, awareness, and force-close coordination.
- Plane Document/WorkMap storage owns durable identity, exact binary, versions,
  protected bindings, assets, and current generation.
- Excalidraw Store/History owns user-facing undo. Remote application uses the
  package's non-capturing update mode and never enters local undo.

This is a closed dispatch, not a generic document-adapter registry.

### Per-attachment authorization

Every WebSocket attachment independently validates the closed document type,
workspace, active project association, document ID, user, and Work Map
generation. It must call the current Plane permission owner even if the Yjs
document is already loaded on that server.

Unreadable documents are denied before content is sent. Readable but noneditable
documents attach read-only. Lock, archive, lost map permission, project-link
loss, or generation change force-close affected Work Map rooms across instances
and require fresh authorization on reconnect. Query-parameter casts and room
knowledge are never authority.

Existing Page realtime locators remain unchanged. Work Map rooms include enough
typed identity and generation to prevent a stale generation from joining or
writing the current document.

Awareness is ephemeral and contains only Plane user identity, pointer,
selection, and idle state. It is neither persisted history nor map content.

### Persistence and failure semantics

Persist the exact Work Map Yjs binary produced by the selected encoding. Do not
regenerate durable state from a scene-JSON mirror. File bytes remain in the
permission-checked Plane asset owner; protected source bindings remain outside
collaborative binary.

An edit is acknowledged to its originating client only after it enters the
Plane-owned durability boundary used for restart recovery. Socket receipt,
Redis publication, or another client's observation is not durability
acknowledgement. The exact callback implementing that boundary must be proved
against the installed persistence path.

Normal durable acknowledgement is silent in the editor. V0 shows no routine
Saving/Saved status, but it must show actionable disconnected, read-only, and
persistence-failed states.

On realtime loss:

- keep the last synchronized scene visible;
- disable every Work Map mutation;
- queue no offline edits; and
- after reconnect, fetch and apply fresh authoritative state before re-enabling
  mutation. Socket reopen alone is insufficient.

Only unacknowledged updates may enter a bounded, expiring recovery journal
scoped to user, Work Map, and generation. Durable acknowledgement or explicit
discard removes them. The journal is not an offline document and does not
permit continued editing or accumulate a multi-update queue.

After persistence failure, freeze mutation and retain the pending update. A
reload, reconnect, permission/lock/archive change, or generation change requires
fresh authorization and authoritative resynchronization. The user may then
explicitly retry if still authorized and the generation is current. Never
replay, merge, discard, or mark recovered state durable silently. Failed retry
remains visible and read-only. Expiry, generation mismatch, revoked authority,
or incompatible authoritative state makes the journal entry non-replayable.
Explicit discard removes it earlier; expiry triggers eventual
device-local deletion without replay. No arbitrary lifetime is selected before
the storage and review contract is proved.

### Versions and generation

One Work Map version identifies exact binary and the protected binding snapshot
from ADR-0002. Restoration changes both atomically, advances generation, and
force-closes the old generation. Clients resynchronize through the same live
editor experience as Page restore. Neither the transport nor recovery journal
may merge a pre-restore update into the new generation.

### Scene-encoding and host gate

Before production integration, run a bounded spike of at most three engineering
days against the exact Excalidraw package Plane will ship. Use two real clients,
deterministic inverted delivery, Hocuspocus persistence, and server restart.
Cover:

1. independent-element moves;
2. move versus resize of one element;
3. delete versus edit and restore;
4. bound-text edit versus container movement;
5. arrow endpoint/binding changes across reconnect;
6. group, z-order, and overlapping reorder; and
7. local undo after remote change.

Use the intended Plane-node carrier and clipboard boundary from ADR-0003. Prove
native arrow binding at both endpoints, transforms, grouping, order, duplicate,
delete, undo, frames, custom data, Copy/Cut `nodeKey` preservation, awaited
replacement before paste insertion, mixed structural selection, one native undo
entry, binary persistence, and restart.

Every case must converge to equivalent non-ephemeral serialized scenes, valid
rendered binding/order, remote changes absent from local undo, and identical
state after server restart.

Start with the smallest whole-element representation supported by the installed
package. Test StoreDelta only if the exact shipped package exposes `onIncrement`,
a deterministic validated wire form, and `applyDeltas` through a narrow public
interface. The newer checkout is not evidence for `0.18.0`.

The Plane Live path fails if it requires a per-field Excalidraw CRDT, unbounded
operation log, whole-scene last-writer-wins repair, hidden mirror geometry,
second hit testing/binding, or broad unexported internals. On material failure,
use the already-approved Plane-secured transport-only native-style relay as the
single selected fallback. It must derive room identity and access from Plane and
leave durable state, versions, assets, and bindings in Plane. Do not build both,
use stock `excalidraw-room`, Firebase, or public room secrets.

## Verification obligations

- Multi-user and multi-instance tests must prove authorization on new
  attachments to already-loaded rooms, read-only enforcement, force-close, and
  no content before authorization.
- Raw binary/socket inspection must prove absence of protected source metadata.
- Exact binary must survive persistence and restart without rich-text
  conversion.
- Disconnect, persistence failure, journal retry, acknowledgement cleanup,
  explicit discard, expiry cleanup, permission revocation, generation mismatch,
  and version restoration must prove no silent edit, replay, loss, or stale
  write.
- The bounded gate report must record package revision, wire representation,
  deterministic inputs/delivery, serialized results, undo result, and selected
  path. ADR-0006 makes it a release gate.

## Alternatives considered

### Stock Excalidraw collaboration

Rejected because its room service and application assumptions do not provide
Plane document identity, project authorization, persistence, or protected
binding/version ownership.

### Select StoreDelta from the newer checkout

Rejected because the installed package does not expose the necessary public
contract. Exact shipped behavior must decide.

### Maintain Plane Live and relay implementations

Rejected because fallback evidence does not justify two protocols, dual writes,
or permanent operational cost.

### Offline Yjs persistence

Rejected because V0 is online-only and silent reconnect merge conflicts with
current authorization and version generations.

## Consequences

- Existing Plane Live authentication must be hardened into document
  authorization before Work Map ships.
- Work Map gains separate binary/content behavior without a second realtime
  service by default.
- Editing availability depends on Plane Live and authoritative resync.
- Encoding uncertainty is paid once in a bounded gate rather than embedded as
  rescue complexity in production.

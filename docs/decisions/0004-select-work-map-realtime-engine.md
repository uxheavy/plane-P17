# ADR-0004: Use Plane Live as the Work map transport relay

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

`apps/live` is the sole Work map realtime shell in V0. The bounded host gate
rejected Yjs scene projection, so Work map uses the approved Plane-secured
transport-only native-style relay. The closed document identity remains
`project_page | work_map`, but the existing Page collaboration path is not
changed.

- Page retains its existing locator, rich-text conversion, title sync, editor,
  and supported APIs.
- Work map frames use the validated `SCENE_UPDATE`, `POINTER_UPDATE`, and
  `PRESENCE_UPDATE` native-style shapes. They never enter a Hocuspocus document,
  Yjs content, Page serializer, HTML/JSON conversion, title observer,
  XML-fragment assumption, or IndexedDB offline persistence.
- `SCENE_UPDATE.payload` is the serialized Excalidraw scene-update string. It is
  opaque to Plane Live: the relay validates only the outer native-style frame
  and byte limit, and it neither parses elements nor invents a server-side scene
  model. Protected bindings remain outside that payload.
- Plane Live owns authenticated WebSocket transport and Redis owns
  cross-instance fan-out. The server adds Plane sender and connection identity,
  never echoes to the originating connection, and never logs scene payloads.
- Plane Document/WorkMap storage owns durable identity, exact binary, versions,
  protected bindings, assets, and current generation.
- Excalidraw Store/History owns user-facing undo. Remote application uses the
  package's non-capturing update mode and never enters local undo.

This is a closed dispatch, not a generic document-adapter registry.

### Per-attachment authorization

Every WebSocket attachment independently validates the closed document type,
workspace, active project association, document ID, user, and Work map
generation. It must call the current Plane permission owner even if the relay
room is already active on that server.

Unreadable documents are denied before content is sent. Readable but noneditable
documents may send and receive only ephemeral pointer and presence frames;
`SCENE_UPDATE` is rejected. Lock, archive, lost map permission, project-link
loss, or version restoration force-close affected Work map connections across
instances and require fresh authorization on reconnect. Query-parameter casts
and room knowledge are never authority.

Existing Page realtime locators remain unchanged. The original project-inclusive
Work map room identity is superseded by the shared-document identity decision
in [ADR-0008](0008-define-work-map-host-authority-and-session-policy.md).
Project association remains a per-attachment authorization requirement. The
client-supplied generation is checked for attach freshness but does not partition
the room: a successful save advances generation without splitting attached
collaborators. Plane Live periodically reauthorizes active connections and
force-closes them when readability, editability, lock, archive, or association
changes. A normal scene save advances generation and therefore does not by
itself force-close an attached room; version restoration uses the explicit
cross-instance force-close seam before clients resynchronize.

Awareness is ephemeral and contains only Plane user identity, pointer,
selection, and idle state. It is neither persisted history nor map content.

### Persistence and failure semantics

Persist the exact Work map scene binary through the generation-CAS scene API.
The relay does not persist, acknowledge, reconstruct, or merge scenes. A
byte-identical retry of the immediately preceding stale generation is
idempotently acknowledged; every other stale write is rejected without changing
bytes or generation. File bytes remain in the permission-checked Plane asset
owner; protected source bindings remain outside collaborative binary.

An edit is acknowledged to its originating client only after it enters the
Plane-owned durability boundary used for restart recovery. Socket receipt,
Redis publication, or another client's observation is not durability
acknowledgement. The exact callback implementing that boundary must be proved
against the installed persistence path.

Điều khoản hiển thị trạng thái lưu được thay bởi [ADR-0008](0008-define-work-map-host-authority-and-session-policy.md): chỉ hiện saving/pending/error; ẩn sau xác nhận lưu bền vững.

The saving-status clause is superseded by ADR-0008: show saving, pending, or
error states only; normal durable acknowledgement remains silent. Actionable
disconnected, read-only, and persistence-failed states remain required.

ADR-0008 is the canonical owner of local authoring and recovery policy. During
transient relay or save failures, the editor may continue native geometry and
authored-text editing and retain exact scene bytes in the existing pending
queue and bounded recovery journal for silent autosync. The relay remains
transport-only: it never authorizes source records, protected bindings, or
assets, and it must not replace a newer local gesture with fetched state on
reconnect.

Generation/CAS and `collaboration_epoch` guards, fresh permission, and the
existing journal lifecycle decide whether a draft may autosync. Permission
revocation, lock/archive or association loss, version restore/epoch change, and
local-storage failure remain hard boundaries. No stale draft may silently
replay, merge, discard, or claim durable authority across a boundary. No
offline asset guarantee is made; raw image bytes are not journaled.

### Versions and generation

One Work map version identifies exact binary and the protected binding snapshot
from ADR-0002. Restoration changes both atomically, advances generation, and
force-closes the old generation. Clients resynchronize through the same live
editor experience as Page restore. Neither the transport nor recovery journal
may merge a pre-restore update into the new generation.

Scene reads return `collaboration_epoch` alongside generation and binary in one
snapshot. Autosave captures that epoch when an edit is queued and checks it before
each CAS retry. Generation conflicts may merge concurrent edits within an epoch;
an epoch change stops autosave and retains the local recovery bytes for explicit
resolution. Late acknowledgements must not apply an old epoch to a resynchronized
canvas. Ordinary saves advance generation without changing the epoch.

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

#### Gate result

The gate completed on 2026-09-02 against
`@excalidraw/excalidraw@0.18.0`, `@hocuspocus/provider@2.2.3`,
`@hocuspocus/server@2.2.3`, and `yjs@13.6.27`. Two real browser clients used a
`Y.Map("elements")` projection, stock `restoreElements` and
`reconcileElements`, and `updateScene(captureUpdate=NEVER)`. Independent moves
converged and the persisted 988-byte Yjs state survived restart byte-identically
with SHA-256
`75d1a7a0c43b1d26502b30810a9925614b322fdd5808660c14acd35ea8f719e0`.

The decisive undo requirement failed: after A moved one native rectangle and B
moved another, A's native Undo reverted both A's local move and B's remote move
on both clients. Therefore the Yjs scene projection is rejected and the
transport-only relay is selected. The durable gate receipt is owned by the
Work map acceptance suite rather than copied into production code.

## Verification obligations

- Multi-user and multi-instance tests must prove authorization on new
  attachments to already-loaded rooms, read-only enforcement, force-close, and
  no content before authorization.
- Raw scene/API/socket inspection must prove absence of protected source
  metadata and scene payloads from logs.
- Exact scene binary must survive persistence and restart without Yjs or
  rich-text conversion.
- Relay or save failure, native authoring continuation, silent autosync,
  acknowledgement cleanup, explicit discard, expiry cleanup, permission
  revocation, generation mismatch, and version restoration must prove that
  local drafts are preserved without unauthorized source, binding, or asset
  writes, stale replay, silent loss, or stale writes.
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

Rejected as a second realtime or persistence owner. The existing bounded local
scene journal and pending queue support transient geometry/text authoring, while
source actions, protected bindings, and assets remain server-authorized; no
cross-epoch recovery merge is introduced.

## Consequences

- Existing Plane Live authentication is hardened into per-attachment document
  authorization plus bounded periodic reauthorization.
- Work map gains cross-instance transport without a second persistence owner or
  a second standalone realtime service.
- Native geometry/text authoring can continue through transient relay or save
  failures under ADR-0008; server-authorized source, binding, and asset
  mutations still depend on Plane Live and current authorization.
- Encoding uncertainty is paid once in a bounded gate rather than embedded as
  rescue complexity in production.

# ADR-0004: Use Plane Live as the Work Map transport relay

## Status

Accepted

## Date

2026-09-02

## Context

Work Map needs low-latency scene updates, pointers, and collaborator presence
without weakening Plane document authorization or creating another durable
document owner. Excalidraw must retain its native element, arrow, grouping,
ordering, and undo behavior. Plane remains authoritative for Work Map scene,
generation, assets, bindings, versions, and lifecycle.

An earlier bounded experiment projected elements into a second persisted scene
representation. Although independent element moves converged, Excalidraw's
native Undo also reverted a remote edit. That violates the requirement that
remote changes never enter the local undo stack. The projection and any second
durable collaborative representation are therefore rejected.

## Decision

Plane Live is a transport-only, Plane-authorized Work Map relay. It authenticates
each WebSocket attachment against the current project association, document,
collaboration epoch, and edit permission before sending content. It accepts the
closed client frame set `SCENE_UPDATE`, `POINTER_UPDATE`, and `PRESENCE_UPDATE`,
validates frame shape and size, attaches server-derived `connectionId` and
`senderId`, and fans valid frames out through Redis to other connections in the
authorized room.

Plane Live and Redis never persist, merge, reconstruct, or acknowledge durable
scene content. Redis is cross-instance fanout only. The Work Map scene API and
generation compare-and-swap are the sole durable content contract. Relay logs
and errors contain identifiers and bounded reason codes, never scene or
protected source payloads. Existing Page realtime behavior remains unchanged.

This is a closed dispatch, not a generic document-adapter registry.

### Per-attachment authorization

Every WebSocket attachment independently validates the closed document type,
workspace, active project association, document ID, user, and
`WorkMap.collaboration_epoch`. It must call the current Plane permission owner
even if the relay room is already active on that server.

Unreadable documents are denied before content is sent. Readable but noneditable
documents may send and receive only ephemeral pointer and presence frames;
`SCENE_UPDATE` is rejected. Lock, archive, lost map permission, project-link
loss, or version restoration force-close affected Work Map rooms across
instances and require fresh authorization on reconnect. Query-parameter casts
and room knowledge are never authority.

Existing Page realtime locators remain unchanged. Work Map room identity is
derived server-side from the authorized workspace and Work Map. The requested
project remains per-attachment authorization context and never partitions one
shared Work Map into separate collaboration rooms. Scene `generation` is the
compare-and-swap revision and advances on a normal durable save.
`collaboration_epoch` is a separate attachment revision and advances only when
version restore or a lifecycle/authority reset invalidates the loaded
collaboration session. A normal scene save neither advances the epoch nor closes
or partitions attached collaborators.

After the owning restore or lifecycle transaction commits, Plane publishes an
immediate Redis force-close for the affected Work Map. Plane Live also
periodically reauthorizes every active connection and compares its attached
epoch with the authoritative epoch; this closes stale sockets if the immediate
control message was lost. Readability, editability, lock, archive, project
association, deletion, and epoch changes fail closed. Reconnect fetches the new
authoritative scene and epoch before editing resumes.

Awareness is ephemeral and contains only Plane user identity, pointer,
selection, and idle state. Each connection sends presence at least every 10
seconds. Receiving clients key collaborators by the relay-issued `connectionId`,
refresh the lease for pointer or presence frames, and remove it after 30 seconds
without a frame. The closing client clears its local connection state
immediately; peers on this or another relay instance may retain its ephemeral
presence until that bounded lease expires. This represents the same user
correctly across multiple tabs. Awareness is not stored in the database, scene,
version, recovery record, or a durable Redis key.

### Source-projection invalidation

Source changes never enter the collaborative scene. The owning Plane mutation
transaction instead appends a `WorkMapProjectionInvalidation` outbox record for
each affected Work Map and its opaque binding keys. A dispatcher claims pending
records, publishes chunks of at most 100 opaque keys to the authorized room, and
marks a record delivered only after publication succeeds. Failure retains it as
pending for at-least-once retry; an expired dispatcher lease may be reclaimed.
An ambiguous publish may therefore deliver the same opaque-key chunk again.
Client invalidation and authoritative hydration are idempotent, so the relay
does not add an exact-once receipt or deduplication store. The outbox contains no
source kind, source ID, project, title, or cause and is not a second source-event
history.

Normal cleanup may hard-delete only a delivered record whose publication receipt
has been stored. An undelivered or ambiguously delivered record remains pending;
age, retry count, process restart, or lease expiry never authorizes hard deletion.

The Redis envelope is server-only. Plane Live rejects browser publication and
translates a valid envelope to `SOURCE_PROJECTIONS_INVALIDATED` for same-room
clients without adding metadata. This server-originated control frame is
receivable by every currently authorized attached client, including read-only
clients; the read-only restriction applies to browser-originated scene,
pointer, and presence publication, not to authoritative invalidation delivery.
On receipt, the web client immediately evicts the named cached projections to
the uniform unavailable tombstone, then rehydrates each key independently with
concurrency eight. One slow, denied, or failed key cannot block or reveal the
outcome of another. A lost Redis subscription closes the socket; reconnect
fails closed, tombstones cached projections, and authoritatively rehydrates
rather than assuming no invalidation was missed.

### Persistence and failure semantics

The durable scene API accepts at most 3 MiB of serialized scene bytes. Its
base64 JSON request remains below Plane's 5 MiB request-body cap, and the Live
relay accepts frames up to 5 MiB. That fixed headroom covers both encodings and
prevents an API-valid scene from becoming impossible to persist, broadcast, or
repair solely because transport framing adds bytes.

Every transmitted update is a full serialized Work Map scene. Relay,
persistence, periodic repair, and recovery serialization all source elements
from `getSceneElementsIncludingDeleted()` and never filter deletion tombstones
in V0. On receipt, the client decodes it, calls
`restoreElements(remote.elements, null)`, reconciles it against
`getSceneElementsIncludingDeleted()` with
`reconcileElements(local, restoredRemote, appState)`, and applies the result with
`updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })`. The same
frame carries the closed opaque `files` metadata from the durable scene. Before
rendering referenced images, the receiver reauthorizes and materializes their
bytes through the Plane asset endpoint and supplies them through Excalidraw's
native file API; relay frames never contain bytes, signed URLs, storage keys, or
credentials. Remote changes therefore use stock Excalidraw semantics without
entering local Undo. Every editable client also broadcasts its full current
scene, including that closed file metadata, every 20 seconds; this repairs a
missed transient relay frame through the same reconciliation path and is neither
a durability timer nor an offline queue.

The client persists through the generation-CAS scene API. It fetches the current
authoritative scene and generation, reconciles its pending scene with that state,
PATCHes the result with the fetched generation, and on a generation conflict
refetches, reconciles, and retries with bounded jitter. The supported ten-editor
envelope permits at most ten total attempts for one pending snapshot; exhausting
that bound enters the visible persistence-failed state. Only a successful HTTP
compare-and-swap is durable acknowledgement. Socket receipt, Redis publication,
or another client's observation is not durability. Scene PATCH also advances
Document modification metadata. File bytes remain in the permission-checked
Plane asset owner; protected source bindings remain outside collaborative scene
content.

An editor who can mutate the Work Map but cannot currently read one already
bound source may preserve that existing opaque carrier while saving unrelated
scene changes. Source authorization is required when a binding is introduced or
transferred, not merely because its existing carrier remains in the full-scene
snapshot. Hydration still returns the uniform unavailable tombstone to that
viewer.

Normal durable acknowledgement is silent in the editor. V0 shows no routine
Saving/Saved status, but it must show actionable disconnected, read-only, and
persistence-failed states.

On realtime loss:

- keep the last synchronized scene visible;
- disable every Work Map mutation;
- queue no offline edits; and
- after reconnect, fetch and apply fresh authoritative state before re-enabling
  mutation. Socket reopen alone is insufficient.

Only one unacknowledged full-scene update may enter a `sessionStorage` recovery
record scoped to user, Work Map, `collaboration_epoch`, generation, and a
request-specific snapshot identity. Durable acknowledgement removes the record
only when that exact snapshot identity is still current. If a newer edit replaced
the record while
an older request was in flight, the acknowledgement advances the newer snapshot
to the returned generation and persistence continues; it never clears the newer
bytes. For an ambiguous retry, the scene endpoint checks byte identity before
the generation comparison: if the submitted bytes already equal the
authoritative scene, it returns the current generation as durable
acknowledgement even when the submitted generation is stale. This
acknowledgement still clears only the matching snapshot identity. Explicit
discard removes the current record. The record is bounded by the browser tab
session: it is not an offline document, does not outlive the tab, does not permit
continued editing, and does not accumulate a multi-update queue.

After persistence failure, freeze mutation and retain the pending update. A
reload, reconnect, permission/lock/archive change, generation change, or
collaboration-epoch change requires fresh authorization and authoritative
resynchronization. The user may then explicitly retry only if still authorized
and both the generation and originating collaboration epoch are current. Never
replay, merge, discard, or mark recovered state durable silently. Failed retry
remains visible and read-only. A generation mismatch whose submitted bytes are
not already authoritative, an epoch mismatch, or revoked authority makes the
record non-replayable. Closing the tab ends its lifetime.

Element deletion tombstones remain in relay, persistence, repair, and recovery
payloads until a controlled compaction advances `collaboration_epoch` and
force-closes the old collaboration session. Image bytes do not wait for that
compaction: after a deletion tombstone is durably acknowledged, a follow-up
scene save may remove file metadata referenced only by deleted elements. The
asset endpoint may then reclaim the object when no current scene or retained
version reaches it. This two-step boundary preserves anti-resurrection data
while preventing deleted image metadata and bytes from becoming permanent.

### Versions and generation

One Work Map version identifies its scene, protected binding snapshot, and
version asset reachability from ADR-0002. Restoration changes the aggregate
atomically, advances scene generation and `collaboration_epoch`, and force-closes
the old epoch. Clients resynchronize through the same live editor experience as
Page restore. Neither relay frames nor tab recovery may cross that boundary.

### Excalidraw fork release provenance

Plane consumes an immutable, verified package artifact rather than a branch,
workspace link, or mutable Git dependency. The selected fork source is
`https://github.com/uxheavy/excalidraw-P17.git`, branch
`master`, source commit `583b3c3c69320b4bf4d78d1de947ff8f44119d8a`.
The deterministic packaging change was merged by
`597da8ae07c944944dc27a760cb7868ee478e66a`. The package-diff base is public
Excalidraw commit `abeeaeba217ab3b5193b78c8d8d63c373b518ced`, on package line
`0.18.0`.

The fork release process builds the changed `common` and `excalidraw` packages
from a clean checkout, installs the packed artifacts into a fresh consumer,
type-checks and builds that consumer, and emits a manifest containing the public
base commit, fork commit, immutable release tag and asset URLs, artifact names,
and SHA-256/SHA-512 digests plus Subresource Integrity. For this source the
immutable, public, hash-verified release is
`https://github.com/uxheavy/excalidraw-P17/releases/tag/packages-v0.18.0-583b3c3c`;
its assets are:

- `uxheavy-excalidraw-common-0.18.0-583b3c3c.tgz`: SHA-256
  `5bf5604bdbcff34216c89e39526650885610ee95c38c8517347e1f00a1979375`,
  SHA-512
  `a888bafa3443be0aae19d4e7b84ff95428ddab851e176c9f3c2c036a4b90600512e56c3eb6e088163b00a1c43a5b9015081eb2efddac22ca385598bcea31a0ab`,
  integrity
  `sha512-qIi6+jRDvgquGdTnuE/5VCjdq4UeF2yfPCwDakuQYAUS5Ww+tuCIFjsAocQ6W5AVCB6y792sIso4VZi86jGgqw==`;
- `uxheavy-excalidraw-0.18.0-583b3c3c.tgz`: SHA-256
  `719ec132475cb5734437f6f76a23bddd2ea3f60bb389d5069cd3196666c64742`,
  SHA-512
  `fbd37a1868c52ffc5dbb0648186e949c58a49622f8e6cca7c71552cc2aee100f1503c44cdab0aeb7d30d3c9576344cd282c73622d9017092b325ceeffbc7a463`,
  integrity
  `sha512-+9N6GGjFL/xduwZIGG6UnFikliL45synxxVSzCruEA8VA8RM2rCut9MNPJV2NEzSgsc2ItkBcJKzJc7v+8ekYw==`.

The Work Map implementation PR must pin the immutable release URLs and those
exact integrity values in Plane's package-manager lockfile before V0 release.
This ADR selects the release input but does not claim that its documentation-only
revision already contains those entries. The acceptance receipt records and
rechecks the manifest and resolved lockfile entries from the final Plane
candidate. The earlier `924b02ea` artifact plan was never released, is absent
from the selected dependency graph, and is superseded; it is not a historical
release or an acceptable fallback.

The release is not accepted if package sources differ from the recorded fork
commit, a clean consumer cannot build, or the Plane lockfile resolves another
artifact. The branch and package version describe provenance, not dependency
resolution. An artifact produced from another commit is not substitutable.

## Verification obligations

- Multi-user and multi-instance tests prove authorization before content,
  read-only enforcement, periodic reauthorization, force-close, and no content
  on a denied attachment to an already-loaded room.
- Deterministic two-client tests prove stock reconciliation convergence, remote
  changes absent from local Undo, the 20-second full-scene repair path, and
  correct behavior through reconnect and service restart.
- Persistence tests prove generation-conflict retry, unchanged durable state
  after failed persistence, mutation freeze, explicit retry/discard, tab-session
  cleanup, permission rejection, generation rejection, and epoch rejection.
- Awareness tests prove the 10-second heartbeat, 30-second lease expiry,
  connection-scoped multi-tab identity, disconnect cleanup, and no durable
  awareness record.
- Raw API, socket, scene, storage, and log inspection proves that protected
  source metadata, asset bytes, signed URLs, credentials, and scene payloads do
  not leak outside their owners.
- Asset tests prove durable tombstone acknowledgement permits removal of file
  metadata used only by deleted elements, retained versions still protect their
  assets, and controlled epoch-changing compaction cannot resurrect elements.
- Release evidence records the exact Plane revision, fork source and base
  commits, immutable artifact manifest, artifact digests, resolved lockfile
  entries, deterministic inputs, final scenes, Undo result, and restart readback.

## Alternatives considered

### Persist a second collaborative document

Rejected because it creates a second durable scene representation and the
bounded experiment made a remote edit part of native Undo.

### Stock Excalidraw collaboration

Rejected because its room service and application assumptions do not provide
Plane document identity, project authorization, persistence, or protected
binding/version ownership.

### Maintain two realtime implementations

Rejected because the requirements are satisfied by one secured relay and one
durable Plane scene owner. Two protocols add dual behavior without an acceptance
need.

### Offline persistence

Rejected because V0 is online-only; background replay could cross current
authorization or version-generation boundaries.

## Consequences

- Plane Live availability is required for editing, but not for durable reads.
- The API owns durability while Live owns only authorized transient delivery.
- Full-scene relay frames trade bandwidth for a small, inspectable contract and
  stock Excalidraw behavior; ADR-0006 enforces the supported envelope.
- Recovery is bounded to one tab-session record and requires a visible user
  decision after fresh authorization.
- Awareness tolerates process and Redis loss because it is intentionally
  ephemeral and reconstructs from connection heartbeats.
- The exact Excalidraw artifact provenance and digest become release inputs,
  not informal checkout knowledge.

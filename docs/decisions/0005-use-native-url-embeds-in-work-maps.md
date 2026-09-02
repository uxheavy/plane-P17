# ADR-0005: Use native Excalidraw URL embeds with document-owned enablement

## Status

Accepted

## Date

2026-09-02

## Context

URL embeds differ from Plane nodes: their URL and title are authored Work Map
content rather than protected references to another Plane authority. They also
execute untrusted remote content and compete with canvas pan/select gestures.

Excalidraw already owns Web Embed creation, validation hooks, DOM overlay,
intrinsic sizing, paste/drop behavior, iframe sandbox, and click-to-interact on
pointer and touch. A Plane pointer-velocity heuristic or cooperative
`postMessage` protocol would create a second interaction system and fail for
cross-origin pages. The durable product choice is who enables untrusted loading
and whether that state belongs to the viewer or the document.

## Decision

Work Map preserves Excalidraw's native Web Embed tool, click-drag link editor,
URL parsing, intrinsic sizing, paste/drop, sandbox, and click-to-interact
behavior. Plane does not implement a parallel URL insertion or gesture path.
Because Work Map reserves `W` for Work Item placement, Web Embed remains
discoverable through Excalidraw's native More tools menu. The host toolbar
extension used for Plane node placement is defined by ADR-0007; it does not add
an `Add URL embed` button or a second embed workflow.

Override provider eligibility so every syntactically valid `http` or `https`
URL may use Excalidraw's native generic iframe fallback. Non-web schemes are
rejected. Provider transformation remains useful but is not an allowlist.
Eligibility is not a claim that the destination permits framing; CSP or
`X-Frame-Options` denial must remain visible as blocked/unavailable rather than
being represented as successful content.

### State ownership

- URL, title, geometry, native element state, enablement, and the enabled origin
  belong to the Work Map scene and version history.
- Persisted enablement belongs to the **document node**, not to a viewer. Once a
  map editor enables that node, it loads for all viewers who can open the map.
- A read-only viewer may load an inert node temporarily for their current
  session, but that viewer-scoped state is ephemeral and never persisted.
- Changing URL origin resets document enablement to inert. A same-origin path or
  query change does not reset solely because the full URL changed.
- Excalidraw native duplication copies the node-owned enablement with the node.

Every arbitrary URL starts as an inert domain-labelled shell. Only a user with
current Work Map edit permission may persist enablement. The enabled iframe uses
the existing Excalidraw sandbox and referrer policy; Plane must not add
permissions or weaken either to make a destination work. Plane never forwards
Plane authentication headers, cookies, tokens, or credentials to the embed
origin and never server-fetches or proxies arbitrary embed URLs.

### Interaction and map state

Embeds use native explicit click/tap-to-interact. Trackpad or touch panning does
not activate an iframe merely because the cursor passes over it. V0 adds no
pointer-motion classifier, pan gate, focus timer, or cross-origin cooperation.

Iframe scrolling/navigation is not a Work Map mutation. Therefore an enabled
embed remains interactable when the map is permission-read-only, locked,
archived, or temporarily disconnected. Moving, resizing, editing the URL,
enabling for the document, or deleting the element remains disabled with other
map mutations.

V0 adds no iframe suspension, warm cache, mount budget, or virtualization
dependency. Such machinery requires measured failure in the supported envelope
and a separate decision because it changes document and browser behavior.

## Failure semantics

- Invalid/non-HTTP(S) input never creates a live iframe.
- A syntactically valid destination that refuses framing remains an honest
  blocked embed; Plane does not proxy or rewrite it.
- A transport failure may expose native retry/reload behavior but does not clear
  document enablement.
- Origin comparison and enablement must not depend on remote iframe cooperation.
- A slow, blocked, or failed destination must settle into a bounded embed shell
  without blocking initial scene interaction or live-node hydration.

## Verification obligations

- Desktop pointer/trackpad and touch-enabled tablet outside-in tests must prove
  inert-first behavior, explicit interaction, canvas pan/select around and over
  the node, document-wide enablement, temporary viewer load, origin reset, and
  native duplication.
- Tests must prove editor versus read-only persistence authority and scene
  mutation gating while iframe interaction remains available.
- URL validation must reject non-web schemes; sandbox attributes must compare to
  the exact native Excalidraw baseline.
- A controlled frame-allowed page and controlled CSP/X-Frame-Options-denied page
  must produce distinct honest visible outcomes; a controlled slow destination
  must prove the canvas remains interactive.
- Browser request inspection must prove no Plane credential reaches the embed
  origin and no Plane server proxies the request.
- The ADR-0006 performance envelope must run five embeds before any optimization
  is proposed.

## Alternatives considered

### Provider allowlist only

Rejected because Work Map is a general spatial document and Excalidraw already
has a generic iframe fallback.

### Viewer-owned remembered enablement

Rejected because editors would not be authoring one shared document state and
viewers would see inconsistent map behavior.

### Automatic activation from pointer motion

Rejected because trackpad pan can leave the pointer static while the iframe
moves underneath it; velocity does not express intent and touch has no hover.

### Plane proxy or custom iframe bridge

Rejected because it weakens origin ownership, expands security scope, and is
unnecessary for native click-to-interact.

## Consequences

- Editors intentionally accept remote loading once per node/origin for the
  shared document.
- Some valid URLs cannot render because the destination controls framing.
- Read-only users can interact with already enabled content without gaining map
  mutation authority.
- Performance optimization is evidence-triggered rather than prebuilt.

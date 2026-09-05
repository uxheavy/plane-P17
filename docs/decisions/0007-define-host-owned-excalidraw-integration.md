# ADR-0007: Define the host-owned Excalidraw integration boundary

## Status

Accepted

[ADR-0008](0008-define-work-map-host-authority-and-session-policy.md) bổ sung quyền sở hữu host và chính sách phiên đã chốt; package boundary và public contracts ở đây vẫn có hiệu lực.

ADR-0008 supplements this decision with accepted host-authority and session policies; this package boundary and its public contracts remain in force.

## Date

2026-09-03

## Context

Work maps need Plane-owned commands in Excalidraw's toolbar, a tldraw-style
shortcut profile, and viewer-authorized content inside native scene geometry. The first integration rendered a Plane toolbar fragment
through `renderToolbarUI` and installed a capture-phase `window` key listener.
That split duplicated toolbar semantics, made focus and text-input behavior
fragile, and left the displayed key badge unrelated to actual dispatch. It also
represented Plane nodes as URL embeddables with synthetic links, which invoked
iframe activation hints and external-link affordances for content that is not a URL.

Excalidraw is the editor and already owns its native toolbar, keyboard event
guards, menu focus, ARIA metadata, and help dialog. Plane owns source discovery,
permissions, localization policy, theme policy, and the actions that open its
source picker. Neither repository should import the other's UI components.

## Decision

The editor fork is a UXHeavy-owned internal package boundary. The fork is
maintained in its own repository and released as immutable, content-addressed
GitHub assets named `@uxheavy/excalidraw` and `@uxheavy/excalidraw-common`.
Plane consumes those package assets through an exact URL and lockfile entry;
Plane does not vendor Excalidraw source or import its private implementation.
Release preparation records the fork source commit and package checksums, and
publishing remains a separate release operation.

The fork exposes three narrow host contracts:

- `hostToolbarItems` describes native toolbar buttons and one-level menus using
  a stable ID, translated label, icon, enabled/checked state, shortcuts, and a
  callback. Excalidraw renders these descriptors alongside its native controls
  on desktop and mobile, including key badges, `aria-keyshortcuts`, tooltips,
  menu focus, Escape cancellation, and help-dialog entries.
- `toolShortcutOverrides` replaces the built-in bindings for selected native
  tools. Excalidraw resolves these bindings in its existing command path and
  applies the same typing, dialog, composition, and modifier guards as native
  shortcuts. The descriptors are instance props only and are never serialized
  into scene data.
- `renderHostElement` projects host-owned content into the bounds of a visible
  native, unlinked element. Excalidraw retains geometry, selection, hit testing,
  transforms, ordering, binding, and history. Linked and iframe-like elements
  never enter this path, so URL embed activation and external-link semantics
  remain exclusive to actual URL content. The callback and its rendering are
  ephemeral and are never serialized into scene data.

For the Work map instance, Plane supplies:

| Binding                                          | Meaning                      |
| ------------------------------------------------ | ---------------------------- |
| `W`                                              | Plane Work Item picker       |
| `D`, `B`, `X`, `P`                               | Native Free Draw             |
| `3`                                              | Native Diamond               |
| `Shift+X`                                        | Native Autoshape             |
| `V`, `H`, `E`, `R`, `O`, `A`, `L`, `F`, `T`, `K` | Existing Excalidraw meanings |

Bucket Fill remains in Excalidraw's More Tools menu. Plane removes its global
keyboard listener and its overlay toolbar/menu imports. Excalidraw has no
Plane dependency and exposes no render-only toolbar seam or internal toolbar
component exports for this integration.

Plane stores each live node as an ordinary rectangle with only its opaque
`nodeKey` in `customData`, then returns the viewer-authorized card through
`renderHostElement`. Plane passes its current locale through a small locale-code adapter, passes the
resolved light/dark theme, and supplies translated host labels. Shared styling
is limited to the public toolbar contract and scoped CSS variables; reusable
Plane and Excalidraw React components remain separately owned.

### Proposed native-agent interaction requirement

Native agents are another consumer of this same host boundary, not a separate
product or scene owner. Any future agent tooling must provide bounded inspect,
edit, and verify operations while preserving the existing owners:

- Plane remains authoritative for agent identity, map/source/project
  authorization, source mutations, bindings, hydration, and lifecycle. A scene
  edit must not become an alternate source-record mutation path or accept
  caller-supplied authority.
- Excalidraw remains authoritative for scene arrangement, selection and hit
  testing, transforms, binding behavior, and history. The current
  `renderHostElement` seam only projects the Plane card over the native carrier
  (`pointer-events: none`); durable agent actions should use the public
  host/editor seam as their primary integration, avoiding a coordinate-only
  contract. Browser interaction remains valid for visual verification or
  fallback, and tooling must not introduce a second scene store.
- Scene writes must use the existing persistence, generation/CAS conflict,
  `collaboration_epoch`, and recovery boundaries. Results must distinguish
  durable Plane acknowledgement from transient relay or observation.

Keep the tool mechanism neutral; source-domain policy remains with its existing
Plane owner, and configurable agent policy must not be compiled into generic
editor or tool mechanisms. Keep the catalog and custom runtime minimal until a
concrete requirement earns them.
Upstream Excalidraw MCP remains an open reuse candidate: check its current API,
license, and code boundary before adoption. Consider code mode only after
measured agent workloads show a batching or large-result context benefit and an
existing sandbox can be reused; this record selects neither path.

## Alternatives considered

### Keep the global Plane key listener

Rejected: capture-phase interception competes with Excalidraw's editor,
requires input and dialog guards to be reimplemented in Plane, and cannot keep
key badges, help, and dispatch in one source of truth.

### Continue rendering a Plane toolbar fragment

Rejected: a render outlet gives Plane control of native editor semantics and
creates a second menu/button surface. Descriptor data is enough for this
closed Work map command set without introducing a general plugin framework.

### Share a React component library between repositories

Rejected: shared styling tokens and typed contracts address the integration
boundary without coupling package ownership, theme providers, or locale
lifecycles.

### Persist shortcut policy in scene data

Rejected: shortcuts are viewer/editor policy, not authored drawing content.
They must change reactively with the host route, locale, and permissions.

### Reuse URL embeddables for Plane nodes

Rejected: a Plane binding is not a URL and must not inherit iframe activation,
click-to-interact, external-link, or Web Embed behavior. Synthetic links also
pollute collaborative content with a second navigation representation.

## Consequences

- Excalidraw's command path is the sole owner of keyboard collision, focus,
  input, dialog, and composition behavior.
- Plane owns only neutral domain callbacks and policy descriptors, so changing
  language or theme re-renders the editor without changing the scene.
- The Work map source picker remains a Plane-owned modal/action boundary and
  can provide the fixed-size placement ghost required by ADR-0003.
- Any future host command should fit the existing descriptor contract; a
  general plugin bus or arbitrary slot system is out of scope.

This ADR supersedes the toolbar and shortcut integration portions of ADR-0003
and refines the native embed placement described by ADR-0005. ADR-0001 and
ADR-0006 link the decision as the product and release boundary.

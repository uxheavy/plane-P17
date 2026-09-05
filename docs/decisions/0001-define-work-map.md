# ADR-0001: Define Work map as a Plane-native spatial document

## Status

Accepted

## Date

2026-09-02

## Context

Plane owns durable work items and Pages but has no production spatial document.
The local prototype proves only that Plane cards and iframes can be overlaid on
an Excalidraw canvas. Its session state, route, names, and module boundaries are
not a production contract.

The expensive decision is whether spatial composition becomes a Plane object,
an Excalidraw file, a Page mode, or another view of work items. That choice
controls identity, access, persistence, navigation, collaboration, and which
system remains authoritative for referenced work.

ADR-0002 defines shared Document lifecycle, ADR-0003 defines protected Plane
nodes, ADR-0004 defines realtime authority, ADR-0005 defines URL-embed trust and
interaction, ADR-0006 defines the proof required to ship, and ADR-0007 defines
the host-owned Excalidraw integration boundary.

[ADR-0008](0008-define-work-map-host-authority-and-session-policy.md) bổ sung SSOT và chính sách phiên. It supplements these records with accepted host-authority and session policies.

## Decision

A **Work map** is a Plane-native collaborative spatial document. It contains:

- native Excalidraw drawing elements and assets;
- permission-aware projections of Plane-owned entities;
- native Excalidraw URL embeds; and
- native Excalidraw arrows, including free-floating arrows.

Plane owns Work map identity, metadata, access, project associations, scene
content, protected source bindings, versions, assets, collaboration identity,
and lifecycle. A Work map does not own or copy a referenced Plane entity.
Source entities remain authoritative in their current owners and retain their
own authorization, mutation, and history.

Opening a Work map grants no source access. A viewer unable to read a referenced
source sees only the geometry-preserving unavailable presentation specified by
ADR-0003. Spatial proximity and arrows create no Plane work-item relationship,
graph record, taxonomy, or reconciliation obligation in V0. Later consumers may
read native scene relationships without changing their current ownership.

### Product surface

Work maps are a first-class project section immediately before Pages. They are
always enabled: V0 adds neither a `work_map_view` flag nor reuse of `page_view`.
Work maps are flat and have no Page hierarchy.

The product routes are:

```text
/{workspaceSlug}/projects/{projectId}/work-maps
/{workspaceSlug}/projects/{projectId}/work-maps/{workMapId}
```

The immutable Work map ID and active project context define the detail route.
An editable title, customer name, demo scenario, or map contents never define
route identity or reusable code vocabulary.

Project lists show document metadata: title, owner, access, active project
associations, and updated time. V0 stores no scene thumbnail. A new Work map
persists an empty Excalidraw scene; any empty-state guidance remains local UI
and contains no persisted template or case data.

Document lifecycle actions remain on the Work map list item, following the
Pages surface. In particular, duplication is not repeated in the editor header.

Global search indexes Work map document metadata, including title, but not
arbitrary scene text. Favorites and recents may discover a Work map. Opening a
workspace-level result resolves through an active associated project the viewer
may access. V0 has no workspace-wide Work map list, management route, or
unscoped detail endpoint.

### Native editor surface

V0 exposes the installed Excalidraw editor's applicable native scene tools and
behaviors: selection and hand tools, shapes, arrows and lines, free drawing,
text, images, frames, links, URL embeds, arrangement, grouping, ordering, and
undo/redo. Excalidraw remains the owner of those semantics.

Plane adds document identity, permissions, persistence, collaboration, and the
closed live-node behavior in ADR-0003. It does not recreate a drawing engine.
Plane live-node entry points render through one generic host extension in the
native Excalidraw toolbar. Work map must not mount a parallel canvas toolbar or
duplicate an applicable native Excalidraw tool.

Desktop web and tablet web are supported. They use Excalidraw's native pointer,
keyboard, trackpad, and touch interaction rather than separate Plane gesture
models. Mobile web and native mobile applications are excluded.

V0 does not expose Excalidraw accounts, cloud storage, shared libraries, AI or
generation, import/export, `.excalidraw` download, PNG/SVG export,
clipboard-as-image, or print export. It also adds no comments, activity feed,
semantic mentions, canvas-text search, relationship model, or offline editing.
Ordinary `@name` canvas text remains non-semantic.

### V1 decision horizon

V1 reserves canvas-text search. Before implementation, its permission, update,
deletion, and version semantics require an explicit decision; V0 persistence
does not build a speculative scene-text index.

Document or image export remains disabled until a permission-safe contract
covers live Plane projections, URL embeds, and native assets. This export
decision is not implied by native copy/paste between Work maps.

## Invariants

- Plane is authoritative for documents and referenced entities; Excalidraw is
  authoritative for native scene behavior.
- Work map access and source-entity access are independent decisions.
- Case data enters through an explicit case-owned fixture or user-created
  document, never reusable Plane defaults, routes, modules, or schemas.
- V0 contains one Work map product, one collaborative scene, and no exported or
  shadow representation presented as equivalent truth.

## Verification obligations

The release proof in ADR-0006 must exercise the real desktop and tablet product
routes, native drawing behavior, a real Plane projection, an URL embed, durable
reload, and independent source authorization. A static HTML canvas, mocked card,
session-only scene, or unscoped route cannot satisfy this ADR.

## Alternatives considered

### Exported Excalidraw file

Rejected because a portable scene cannot safely hydrate current Plane entities,
apply viewer permissions, or own Plane lifecycle and collaboration.

### Page content mode

Rejected because rich-text hierarchy and spatial scene semantics have different
content and collaboration owners. ADR-0002 makes them sibling subtypes.

### Project view

Rejected because a Work map owns a durable authored scene and may contain URLs,
free drawing, and entities from multiple accessible projects; it is not the
result of one work-item query.

### Copy source entities into the map

Rejected because copied metadata becomes a competing source of truth and may
outlive current source permission.

## Consequences

- Plane gains a new first-class aggregate and project surface.
- The prototype is disposable evidence rather than migration input.
- Source hydration and collaboration are security boundaries, not rendering
  details.
- Native Excalidraw behavior constrains the host integration and must be proven
  against the exact shipped package.

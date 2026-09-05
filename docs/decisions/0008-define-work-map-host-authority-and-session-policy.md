# ADR-0008: Quyền sở hữu host và chính sách phiên Work map / Host authority and session policy

## Trạng thái / Status

Accepted — 2026-09-04.

Revised — 2026-09-05: transient relay or save failures no longer freeze native
scene authoring. This records the product decision; implementation and
outside-in proof remain separate obligations.

Các quyết định sản phẩm đã được chấp thuận; triển khai và kiểm chứng còn phải đối chiếu riêng. ADR này không phải biên bản release hoặc bằng chứng tính năng đã hoạt động.

Product decisions are accepted; implementation and verification remain separate obligations. This ADR is not a release receipt or a claim of working behavior.

## Bối cảnh / Context

[ADR-0001](0001-define-work-map.md) đặt Work map trong Plane; [ADR-0007](0007-define-host-owned-excalidraw-integration.md) định nghĩa hợp đồng với editor. Cần làm rõ SSOT cho identity, preferences và trạng thái phiên, tránh hai ứng dụng cạnh tranh quyền sở hữu cùng dữ liệu.

ADR-0001 makes Work map a Plane document; ADR-0007 defines the editor integration. A separate package must not become a second authority for identity, preferences, or document storage. One authoritative owner may supply transient rendering projections without creating another independently editable source of truth.

## Quyết định / Decision

### Ranh giới sản phẩm / Product boundary

Fork phục vụ Plane Runner, không phát triển thành sản phẩm Excalidraw độc lập cho người dùng. Giữ repository/package và playground kỹ thuật riêng theo ADR-0007; không thêm account, preferences, workspace hoặc cloud storage riêng. Work map chỉ dành cho user Plane đã đăng nhập và có quyền; chưa có anonymous access hoặc public sharing.

The fork serves Plane Runner, not a standalone end-user product. Retain the separate repository/package and development playground under ADR-0007. Do not add separate accounts, user settings, workspaces, or cloud storage. Access requires an authenticated, authorized Plane user; anonymous access and public sharing are excluded from this release. This does not change source-entity authorization or the immutable release boundary.

### Nguồn sự thật / Sources of truth

| Concern          | Chủ sở hữu và hợp đồng / Owner and contract                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | Plane xác thực user ID, tên và avatar; editor chỉ render dữ liệu được phép xem. Plane authenticates identity and supplies authorized profile projections; client-claimed identity is not authority.                                                 |
| Presence         | Một entry cho mỗi connection, cùng identity Plane; số đếm là active sessions, không phải unique people. One entry per connection; multiple tabs may show the same person more than once. Presence is ephemeral, never scene content.                |
| i18n             | Plane quyết định locale, timezone và định dạng ngày/số. Plane domain strings remain in Plane's dictionary; native editor strings remain in the editor dictionary. Missing translations fall back to English without changing the user's preference. |
| Theme            | Plane sở hữu light/dark và design tokens cho màu UI, typography, border, spacing và focus. Plane supplies theme and tokens; editor components retain keyboard, focus and accessibility semantics.                                                   |
| Scene            | Excalidraw sở hữu geometry, selection và history; Plane owns durable scene bytes, generation, epoch, protected bindings, and assets. Excalidraw owns editing semantics; Plane owns server authority.                                                |
| Local authoring  | Excalidraw owns native geometry and authored text. Plane's existing pending queue and bounded recovery journal retain unacknowledged scene bytes as the local draft SSOT.                                                                           |
| Server authority | Plane owns source records and actions, protected bindings, asset bytes and metadata, access, generation, and collaboration epoch. Hydration is a read-only viewer projection; a local draft never grants source access.                             |

Không có language/theme selector độc lập trên canvas. Đổi locale/theme không làm mất selection/history, không dịch nội dung do người dùng viết, không ghi đè màu hình hoặc nền canvas đã chọn và không tạo bước Undo. Không copy toàn bộ dictionary hoặc thay toàn bộ component editor chỉ để dùng chung code.

There is no independent canvas language/theme selector. Locale/theme changes preserve selection and history, do not translate authored text, overwrite authored colors/backgrounds, or create undo entries. Shared authority does not require one giant dictionary or wholesale replacement of editor components.

### Canvas dùng chung giữa các project / Shared canvas across projects

Một Work map liên kết với nhiều project vẫn là **một tài liệu**, không phải nhiều bản sao. Scene, generation, assets, bindings và lịch sử phiên bản thuộc Work map đó. Project là ngữ cảnh kiểm tra quyền của từng request/connection, không phải khóa chia scene hoặc phòng realtime. Quyết định này thay điều khoản room identity gồm project trong ADR-0004.

A Work map linked to multiple projects remains **one document**, not separate copies. Its scene, generation, assets, bindings, and version history share that document owner. Each request and connection is authorized through its requested active project association. The server derives room identity from the authorized workspace and Work map ID; project identity is authorization context, not a scene or room partition. This supersedes ADR-0004's project-inclusive room-identity clause.

Liên kết không tự cấp quyền cho project khác hoặc nguồn được đặt trên canvas. Mọi attachment phải kiểm tra quyền riêng, kể cả phòng đã có người dùng; mất quyền hoặc mất liên kết buộc connection tương ứng xác thực lại. Restore áp dụng cho tài liệu chung và vô hiệu hóa các connection của tài liệu đó qua mọi project. Các bản đồ khác không bị ảnh hưởng.

A link grants neither access through other projects nor access to referenced source entities. Every attachment is authorized independently, including attachments to an already-loaded room; lost access or association invalidates the affected connection. Restore applies to the shared document and invalidates its connections across project routes, without affecting unrelated maps. Protected source projections remain permission-checked per viewer under ADR-0003.

Giữ mô hình hiện có để tránh nhân đôi storage và conflict domains. Canvas riêng theo project bị loại: chỉ tách phòng mà vẫn dùng chung scene/CAS sẽ làm các editor mất đồng bộ. Cần kiểm chứng hai route hợp lệ cùng thấy một scene, route không liên kết bị từ chối và mất quyền không thể tiếp tục ghi.

Retain the existing document owner rather than duplicate storage and conflict domains. Separate per-project canvases are rejected: splitting rooms while retaining shared scene/CAS storage would break convergence. Verification must prove that authorized linked routes share one scene, an unlinked route is denied, and revoked access cannot continue writing.

### Chính sách phiên và thao tác / Session and interaction policy

- **Viewport:** zoom/pan chỉ trong phiên; mở lại fit-to-content. No persisted per-user or shared viewport preference, and no collaborative viewport changes.
- **Shortcuts:** một profile cố định do Plane sở hữu, giữ bindings của ADR-0007, gồm `W` cho Work Items. No user remapping in this release. Badges, Help and dispatch derive from the same definitions through the editor's native guards.
- **Undo:** chỉ thao tác canvas, gồm hình vẽ, di chuyển và thêm/xóa node; không hoàn tác sửa dữ liệu nguồn Plane. Canvas history excludes underlying Plane record mutations and, as required by ADR-0004, remote changes.
- **Library/export:** hoãn Library cá nhân và workspace, xuất ảnh và editable scene. Hide these product entry points; retain normal drawing and permission-safe copy/paste under ADR-0003. Other exclusions in ADR-0001 remain unchanged.

### Lưu trữ, mất kết nối và phục hồi / Saving, disconnection and recovery

Transient relay or save failures do not freeze native canvas authoring. Users
may continue creating and editing native geometry and authored text. The
existing pending queue and bounded, expiring local recovery journal retain exact
scene bytes for silent autosync when current server authority is available. This
is one local draft SSOT, not a second document store, and the default transient
path does not show a recovery card.

Lỗi relay hoặc lưu tạm thời không khóa việc tạo và sửa geometry/text native.
Queue hiện có và journal local có giới hạn, hết hạn giữ nguyên scene bytes để
đồng bộ ngầm khi có lại quyền server. Đây là một SSOT cho draft local, không
phải kho tài liệu thứ hai; luồng tạm thời mặc định không hiện recovery card.

Plane remains authoritative for source records and actions, protected binding
changes, and asset reads and writes. A disconnected or failed-save editor may
not invent or bypass those mutations. There is no offline asset guarantee; raw
image bytes are not journaled.

Plane vẫn là owner có thẩm quyền cho source records/actions, thay đổi binding
được bảo vệ và đọc/ghi assets. Editor mất kết nối hoặc lưu lỗi không được tự
ý tạo hay vượt qua các mutation này. Không có cam kết asset offline; raw image
bytes không được journal.

On reconnect, preserve the newer in-memory or journaled draft; do not replace an
active gesture with fetched authoritative scene. Existing generation/CAS and
`collaboration_epoch` guards, together with fresh permission, decide whether
silent autosync may proceed. Permission revocation, restore or epoch change,
and local-storage failure remain hard boundaries: they fail closed for replay
and require fresh state or explicit resolution. No draft may silently replay,
merge, discard, or claim durable authority across such a boundary.

Khi kết nối lại, giữ draft mới hơn trong memory hoặc journal; không thay gesture
đang diễn ra bằng scene authoritative vừa tải. Guard generation/CAS và
`collaboration_epoch` hiện có, cùng quyền mới, quyết định có thể autosync ngầm.
Thu hồi quyền, restore hoặc đổi epoch, và lỗi local storage vẫn là hard boundary:
replay phải fail-closed và cần state mới hoặc xử lý explicit. Draft không được
âm thầm replay, merge, discard hoặc nhận là durable qua boundary đó.

Thời hạn đã chốt: **24 giờ**, tính từ khi bản cập nhật chưa được lưu được đưa vào journal. Lưu thành công, logout hoặc discard xóa sớm hơn; không kéo dài thời hạn chỉ vì đọc hoặc retry. Khi ứng dụng không chạy, browser không bảo đảm chạy cleanup đúng thời điểm: entry hết hạn phải bị từ chối khi đọc và xóa ở lần cleanup tiếp theo.

The accepted retention is **24 hours** from journaling the unacknowledged update. Durable save, logout, or discard removes it earlier; reading or retrying does not renew expiry. Browsers cannot guarantee cleanup while the application is closed: expired entries must be rejected on read and removed on the next cleanup opportunity.

Ưu tiên cơ chế Retry/Discard hiện có khi cần xử lý boundary, kiểm tra lại quyền
và trạng thái server trước khi retry. Draft trong cùng epoch có thể merge qua
các revision CAS thông thường và autosync ngầm; draft qua boundary không được
replay. Không tạo map khác hoặc thêm màn hình so sánh chỉ để phục hồi. Phải
chứng minh CAS và generation thực tế ngăn ghi đè stale; kiểm tra generation
trong UI chưa đủ.

Reuse the existing explicit Retry/Discard mechanism at a boundary with fresh
authorization and server-state checks. Same-epoch drafts may merge through
ordinary CAS revisions and autosync silently; drafts across an authority
boundary remain non-replayable. Do not create another map or add comparison UI
just for recovery. Verify actual CAS/generation enforcement against stale
overwrites rather than treating a UI generation check as proof.

**Thay điều khoản hiển thị saving của ADR-0004:** chỉ hiện trạng thái khi đang lưu, chưa lưu hoặc có lỗi; ẩn sau xác nhận lưu bền vững. `connected` không có nghĩa `saved`.

**Amend ADR-0004's saving-status clause:** show status only while saving, pending, or in error; become silent after durable acknowledgement. Connection status is not a durability acknowledgement. All other ADR-0004 persistence, expiry, authorization, and transport obligations remain in force.

## Phương án không chọn / Alternatives not selected

- **Ứng dụng editor độc lập / Standalone editor product:** thêm identity, settings và storage cạnh tranh với Plane. Rejected as duplicate product authority.
- **Một dictionary/component library cho mọi thứ / Wholesale UI consolidation:** tăng coupling và công sức đồng bộ upstream khi contracts/tokens đã đáp ứng ranh giới. Rejected without a demonstrated shared responsibility.
- **Gộp presence theo user, remap cá nhân, viewport bền vững / Additional preference machinery:** chưa cần cho phiên bản này. Deferred in favor of connection-based presence, fixed shortcuts and session-only viewport.
- **Kho document/asset offline không giới hạn hoặc tự merge qua epoch / Unbounded offline document/asset store or cross-epoch recovery merge:** bị loại. Journal/queue local có giới hạn chỉ hỗ trợ authoring geometry/text trong lỗi tạm thời; source actions, bindings và assets vẫn cần quyền server.

## Hệ quả và kiểm chứng / Consequences and verification

Ưu tiên cơ chế hiện có cần thay đổi ít nhất nhưng vẫn an toàn. Sự đơn giản không miễn kiểm tra authorization, data loss, accessibility hoặc stale writes. Không chọn trước một API host-context mới, serializer hoặc shared store; thiết kế cụ thể phải xuất phát từ các owner hiện có.

Prefer the smallest safe change to existing mechanisms. Simplicity does not waive authorization, data-loss prevention, accessibility, or stale-write protection. This ADR does not preselect a new host-context API, serializer, or shared store.

Các owner triển khai cần đối chiếu: Work map editor integration và awareness trong Plane web; Plane locale/theme/profile owners; scene API và Plane Live; các public editor contracts của ADR-0007. Dùng acceptance hiện có của ADR-0006 để chứng minh authoring native trong lỗi tạm thời, autosync ngầm, giữ draft khi reconnect, boundary quyền/restore/epoch/storage và không tự ghi source/binding/asset. Các seam `epoch_completion` và `rootUI` vẫn đang triển khai; proof outside-in còn chờ và ADR này không khẳng định đã pass.

Implementation owners are Plane web's Work map integration/awareness, Plane
profile/locale/theme owners, the scene API and Plane Live, and ADR-0007's public
editor contracts. Use ADR-0006's existing acceptance path to prove transient
native authoring, silent autosync, draft preservation across reconnect, the
permission/restore/epoch/storage boundaries, and no unauthorized source,
binding, or asset writes. The `epoch_completion` and `rootUI` seams remain in
progress; outside-in proof is pending, and this ADR asserts no pass.

ADR này bổ sung ADR-0001/0007 và thay các điều khoản saving-status và room identity đã nêu của ADR-0004; không supersede toàn bộ các ADR đó. Các lựa chọn chưa được chốt không trở thành yêu cầu chỉ vì không được liệt kê ở đây.

This ADR supplements ADR-0001/0007 and supersedes only the identified saving-status and room-identity clauses of ADR-0004, not those records in full. Unresolved product choices are not implicitly decided by omission.

# Vietnamese Product Language

## Reader and Voice

Write for ordinary Vietnamese users, including people who do not work in
software. Prefer familiar actions and outcomes over names for UI mechanisms.

- Address the reader as `bạn` when an actor is needed.
- Use concise, active sentences and sentence case.
- Write directly in Vietnamese; do not mirror English word order.
- Avoid em dashes and routine exclamation marks. Keep `!` only for a genuine
  welcome or celebration.
- Do not translate code, identifiers, URLs, keyboard shortcuts, or literal text
  the user must type.

## Plane Terminology

| English concept | Vietnamese | Usage |
| --- | --- | --- |
| work item | mục công việc | Use consistently across Plane-owned work. |
| workspace | không gian làm việc | Use for the Plane workspace boundary. |
| Module | nhóm công việc | A focused group inside a project, not a subproject. |
| parent work item | mục công việc mẹ | Use `mục mẹ` when the surrounding context already says work item. |
| parent-child relationship | quan hệ mẹ-con | Keep the chosen hierarchy metaphor consistent. |
| Cycle | Chu kỳ | Use in short labels, navigation, buttons, and feature names. |
| cycle | chu kỳ làm việc | Use on first mention in longer explanatory copy; later mentions may use `chu kỳ`. |
| Widget | thẻ thông tin | Use `thẻ` only when the dashboard context is already obvious. |

Do not translate Plane, Plane AI, Power K, PQL, Intake, Active Cycles, Sticky,
Stickies, Epic, Pro, Business, Enterprise, third-party products, or acronyms.

## Translate `View` by Purpose

`View` does not have one Vietnamese equivalent. Describe what the user gets:

| UI purpose | Vietnamese |
| --- | --- |
| Plane saved-filter object | bộ lọc đã lưu |
| display mode or default display | cách hiển thị |
| custom list organized for a purpose | danh sách tùy chỉnh |
| peek view | phần xem nhanh |
| create from the current filters | Lưu cách lọc này |
| switch display mode | Đổi cách hiển thị |

Read the English namespace and the consumer before choosing. Do not use `chế
độ xem` merely because the source says `view`.

## Context Checks

Before accepting a sentence, ask:

1. Does it tell a non-technical reader what they can do or find?
2. Does the term keep the same meaning in nearby labels, actions, and messages?
3. Does a short label stay short while explanatory copy supplies enough context?
4. Would a Vietnamese product writer use this sentence without seeing English?

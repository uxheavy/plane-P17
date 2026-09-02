---
name: translate
description: "Translate or review Plane locale JSON. Use for work under packages/i18n/src/locales when wording must remain natural while keys, ICU messages, placeholders, tags, and product terminology stay intact."
author: nqh-packages
version: 1.0.0
paths:
  - packages/i18n/src/locales/**
---

# Translate Plane Locales v1.0.0

## Scope

Translate Plane's interface from `packages/i18n/src/locales/en` into another
locale. English is the source of meaning; the target locale owns the natural
wording.

For Vietnamese work, read [`references/vi-VN.md`](references/vi-VN.md) before
editing. Its glossary records the current product-language decisions.

## Workflow

1. Read the complete English namespace and the current target namespace.
2. Identify the UI purpose of each string. Do not translate an isolated word
   without knowing whether it names a feature, action, filter, field, or state.
3. Reuse the locale glossary, voice, and one useful nearby precedent.
4. Write for the target reader directly. Preserve meaning rather than English
   sentence structure.
5. Review the affected namespace as a whole for repeated terms and awkward
   combinations introduced by replacement.
6. Run the locale checker, package sync and format checks, and `git diff --check`.

## Structural Invariants

Change values only. Preserve exactly:

- JSON keys and namespace structure;
- interpolation argument names and occurrences;
- ICU argument types and selectors such as `plural`, `one`, and `other`;
- HTML, JSX, and numbered tags;
- URLs, Markdown, escapes, keyboard shortcuts, and intentional line breaks;
- product names and technical identifiers marked as do-not-translate.

Keep Plane, Plane AI, Power K, PQL, Intake, Active Cycles, Sticky, Stickies,
Epic, plan names, third-party product names, and acronyms unchanged unless the
locale reference explicitly says otherwise.

## Mechanical Edits

Prefer a codemod when a change is broad and mechanically expressible. Make it
key-aware when the same English word has different UI meanings. A safe codemod:

1. asserts the expected source shape or match count before writing;
2. changes only the requested locale values;
3. aborts without partial output when its preconditions fail;
4. preserves formatting and structural tokens; and
5. produces no changes when run a second time.

Use direct editing for small or judgment-heavy copy. Do not turn a glossary
decision into a blind repository-wide string replacement.

## Verification

For `vi-VN`, run from the repository root:

```bash
node .agents/skills/translate/scripts/check-vi-vn.mjs
pnpm --filter @plane/i18n check:sync
pnpm --filter @plane/i18n check:format
git diff --check
```

Static checks do not prove that text fits or reads well in the product. For a
material user-facing change, inspect the affected interface in Vietnamese when
the application is available; otherwise report runtime review as unavailable.

## Field Decisions

The `paths` field limits discovery to Plane locale work. Not adding a model,
agent, tool allowlist, or invocation restriction because translation quality
depends on the active harness and human review rather than a fixed runtime.

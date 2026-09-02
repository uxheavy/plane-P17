# Vietnamese Locale Map

## Scope

This directory owns the Vietnamese (`vi-VN`) values for Plane's interface. The
canonical source text is the matching key in [`../en`](../en).

## Where Truth Lives

- Translation workflow: [`../../../../../.agents/skills/translate/SKILL.md`](../../../../../.agents/skills/translate/SKILL.md)
- Vietnamese voice and terminology: [`../../../../../.agents/skills/translate/references/vi-VN.md`](../../../../../.agents/skills/translate/references/vi-VN.md)
- Mechanical locale checks: [`../../../../../.agents/skills/translate/scripts/check-vi-vn.mjs`](../../../../../.agents/skills/translate/scripts/check-vi-vn.mjs)

## Canonical Commands

Run from the `plane` repository root:

```bash
node .agents/skills/translate/scripts/check-vi-vn.mjs
pnpm --filter @plane/i18n check:sync
pnpm --filter @plane/i18n check:format
git diff --check
```

## Local Gotchas

- Edit `packages/i18n/src/locales/vi-VN`; `packages/i18n/locales/vi-VN` is not
  the canonical locale source.
- Change values only. Preserve keys, ICU structure, interpolation arguments,
  tags, escapes, and intentional line breaks from the English entry.
- For broad mechanical edits, use a key-aware codemod with precondition checks
  and prove that a second run produces no changes.

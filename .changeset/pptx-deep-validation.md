---
'@json-to-office/shared-pptx': minor
'@json-to-office/jto-cli': minor
---

feat(pptx): real validation for `pptx validate` — deep, path-aware checking of whole presentations

`jto pptx validate` previously returned valid unconditionally: unknown component names, dead props (e.g. `fontColor` on `text`), and malformed trees all passed. shared-pptx now ships a unified validation facade (`validate` / `validateStrict`) mirroring shared-docx: a deep walk validates every component's props against its registry schema with precise JSON-pointer paths, enforces container narrowing (`pptx` → `slide` → content), rejects children on leaf components and unknown top-level fields, validates slide `placeholders` values, checks image source mutual exclusivity, and validates themes against `ThemeConfigSchema`. The CLI wires both `pptx` document and theme validation to it, and a missing/broken validation module now reports an error instead of silently passing the file.

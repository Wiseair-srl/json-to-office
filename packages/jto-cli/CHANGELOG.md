# @json-to-office/jto-cli

## 0.15.0

### Minor Changes

- ffd5c3d: fix(docx): table rows no longer inherit body-paragraph spacing

  Table cells render as a single wrapper paragraph that previously inherited the
  theme's `normal` style, dragging body-prose rhythm (8–10pt after-spacing +
  1.4–1.5× line) into every row. That inflated row height by ~9pt regardless of
  font size, cell padding, or the cell `height` prop (which is `atLeast`, so it
  can only grow rows). A 5pt-font row still rendered ~22pt tall.

  Table cells (and header cells) now get their own dense paragraph spacing by
  default — no extra before/after spacing, single line. Vertical breathing room
  is the job of cell padding. Measured row pitch for a single-line 11pt row drops
  from ~28.9pt to ~13.7pt.

  Themes can tune table spacing via two new conventional style keys (standard
  `StyleProperties`, no schema change):

  - `styles.tableCell` — paragraph spacing/line for body cells
  - `styles.tableHeader` — paragraph spacing/line for header cells

  ```json
  {
    "styles": {
      "tableCell": {
        "spacing": { "after": 6 },
        "lineSpacing": { "type": "multiple", "value": 1.5 }
      }
    }
  }
  ```

  Note: this changes the rendered height of existing tables (rows become tighter).
  Documents relying on the old roomier rows can restore them per-theme via
  `styles.tableCell` / `styles.tableHeader`.

### Patch Changes

- Updated dependencies [ffd5c3d]
  - @json-to-office/core-docx@0.15.0

## 0.14.0

### Minor Changes

- afe9789: feat(docx): tracked-change document diff

  Diff two docx JSON definitions into a redline rendered as native Word tracked
  changes (accept/reject, author, timestamp; opens in review mode).

  - New `revision` prop on `paragraph`/`heading`/`list` items and a
    `trackRevisions` root prop, rendered as `w:ins`/`w:del`.
  - `diffDocuments(oldDoc, newDoc)` (word-level diff, block alignment, fidelity
    summary), re-exported from `@json-to-office/json-to-docx`.
  - CLI: `jto docx diff <old> <new> -o redline.docx`.
  - Playground: `POST /api/docx/diff` endpoint and a Compare dialog that opens
    the redline as a normal document with live preview.

### Patch Changes

- Updated dependencies [afe9789]
- Updated dependencies [8916aaa]
  - @json-to-office/shared-docx@0.14.0
  - @json-to-office/core-docx@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/core-pptx@0.13.0
  - @json-to-office/shared-docx@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/shared-docx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.11.0

### Minor Changes

- 7f9679b: Introduce `@json-to-office/jto-cli`, a lightweight CLI package containing only the non-playground commands (`generate`, `validate`, `schemas`, `discover`, `init`, `fonts`). Install it instead of `@json-to-office/jto` in CI or scripting contexts to skip the React/Monaco/Vite/AI-SDK playground deps.

  `@json-to-office/jto` is unchanged for users — it now depends on `jto-cli` and adds the `dev` playground command on top, so `jto docx dev` / `jto pptx dev` still work as before.

  Note: the binary in `@json-to-office/jto-cli` is `jto-cli`, not `jto` — update CI scripts that previously invoked `jto` accordingly.

# Migrating to 0.19.x (docx)

Documents that passed `jto docx validate` under 0.17.x can fail on 0.19.1+ with errors like:

```
✖ Document validation failed:
  /children/2/children/0/props/font/size: At /font/size: Expected number to be less or equal to 72
  /children/0/props/font/boldColor:      At /font/boldColor: Unexpected property
  /children/0/props/font/characterSpacing: At /font/characterSpacing: Expected object
```

If you hit one of these, read the next section first — it explains why the fix is almost always a one-line edit and never a rendering change.

## Why these surface now

**No schema rule changed between 0.17 and 0.19.** All three shapes above were already invalid in 0.17 — the `size` cap, the `boldColor` placement and the object form of `characterSpacing` all date back to the initial schema. What changed in **0.19.1** is validation _coverage_.

Before 0.19.1 the CLI/library validator (`validate.document` / `validate.jsonDocument`) only re-validated the root's direct children and one level of `section` children. Props nested any deeper were never checked:

- inside `text-box` / `columns` children, at any depth
- inside `header` / `footer` regions (typed loosely as `Type.Any()`)
- inside `table` cells and column headers (cell props typed `additionalProperties: true`)
- anything a **custom component** emits, since its output lands in one of the above

  0.19.1 made the walk cover the whole tree, so the CLI now reports what the in-editor (Monaco) validator — which ran the generated JSON Schema over the entire document — had been reporting all along. The two validators now agree on the same errors at the same paths.

**Practical consequence:** an offending prop in one of those positions was not doing anything. It was skipped by validation _and_ ignored by the renderer. Fixing it changes what validates, not what your document looks like. The one exception is `font.size`, covered next.

## 1. `font.size` above 72pt — no longer an error

**Status: the schema was wrong. Fixed — no action needed.**

The 72pt cap had no basis in the format. OOXML stores font size in `w:sz` as half-points (`ST_HpsMeasure`, unsigned, no 72pt ceiling) and Word's own UI accepts up to 1638pt. The renderer never clamped, so display type — cover numerals, chapter headings, pull quotes — always emitted correctly; a 163pt heading produces `<w:sz w:val="326"/>`, which Word opens and renders as designed.

The maximum is now **1638pt**. The `minimum: 8` floor is unchanged.

```jsonc
// Valid — and always rendered correctly, even while the schema rejected it.
{ "name": "paragraph", "props": { "text": "07", "font": { "size": 163 } } }
```

If you worked around the cap by moving display type into a raw image or a custom component, you can move it back to real text.

## 2. `boldColor` belongs beside `font`, not inside it

**Status: was never valid, and was silently ignored. Move it.**

`boldColor` sets the color of `**bold**` segments in rich text. It has always been a sibling of `font` on paragraph/heading props — a behavior option rather than a font property — and `FontDefinitionSchema` has always been `additionalProperties: false`, so nesting it under `font` never applied it.

```jsonc
// Before — accepted only where validation didn't reach; never rendered.
{ "props": { "text": "Some **bold** text", "font": { "family": "Arial", "boldColor": "#C81E1E" } } }

// After
{ "props": { "text": "Some **bold** text", "font": { "family": "Arial" }, "boldColor": "#C81E1E" } }
```

Moving it will change your output — the bold segments pick up the color they were meant to have all along. If you prefer the current appearance, delete the property instead of moving it.

## 3. `characterSpacing` is an object, not a number

**Status: was never valid, and was silently ignored. Convert it.**

`characterSpacing` has always been `{ type: 'condensed' | 'expanded', value: number }`. A bare number has no `type`, so the adapter read `undefined` and emitted no spacing at all.

```jsonc
// Before — never rendered.
{ "font": { "characterSpacing": 0 } }
{ "font": { "characterSpacing": 1.5 } }
{ "font": { "characterSpacing": -0.5 } }

// After
// 0 was a no-op — just delete it.
{ "font": { "characterSpacing": { "type": "expanded", "value": 1.5 } } }
{ "font": { "characterSpacing": { "type": "condensed", "value": 0.5 } } }
```

`value` is a magnitude and is always positive; `type` carries the direction. A negative number in the old shape maps to `condensed` with its absolute value.

## Why there is no compatibility shim

A deprecation shim would mean _adding_ support for shapes the library never accepted and never rendered. Since both old shapes were no-ops, there is no behavior to preserve — a shim would only postpone an edit that is already safe to make. Fix them once and both validators agree.

## Checking a whole document at once

Validation now reaches every nested position, so a single run reports all remaining occurrences with full paths:

```sh
jto docx validate path/to/document.json
```

Custom components are validated on their emitted output, so an error path may point at a component's children rather than at hand-written JSON. Fix it in the component's render function.

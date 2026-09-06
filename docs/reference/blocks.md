# JSON blocks

Blocks compose reusable document structure from JSON. Code plugins provide calculations, external I/O and programmable behavior. Both formats support the contract below; format is inherited from the containing document. DOCX definitions expand into flowing content and may carry [section state](#section-state); PPTX definitions expand into positioned slide content and may carry [slide effects](#pptx).

## Complete custom example

This document requires no plugin or catalog lookup. Change the definition to change every invocation.

```json
{
  "name": "docx",
  "props": {
    "theme": "consulting",
    "blocks": {
      "summary": {
        "description": "A short conclusion with an optional source group.",
        "slots": {
          "title": { "type": "string", "default": "Summary", "maxWords": 8 },
          "text": {
            "type": "string",
            "required": true,
            "minLength": 1,
            "maxWords": 60
          },
          "source": { "type": "string", "maxWords": 20 }
        },
        "body": [
          {
            "name": "heading",
            "props": { "level": 2, "text": { "$slot": "/title" } }
          },
          { "name": "paragraph", "props": { "text": { "$slot": "/text" } } },
          {
            "$if": "/source",
            "then": [
              { "name": "divider", "props": { "thickness": 0.5 } },
              {
                "name": "paragraph",
                "props": {
                  "text": { "$slot": "/source" },
                  "font": { "size": 9 }
                }
              }
            ]
          }
        ]
      }
    }
  },
  "children": [
    {
      "name": "section",
      "children": [
        {
          "name": "block",
          "props": {
            "ref": "summary",
            "slots": { "text": "Retention improved after the service change." }
          }
        }
      ]
    }
  ]
}
```

## Definitions and slots

`props.blocks` maps names (`^[a-zA-Z][a-zA-Z0-9_-]*$`) to `{ description?, slots, body, section?, slide? }`. Definitions belong to one document and inherit its format; no `format` property is accepted. The selected renderer determines available components and operations. A name conflicting with a registered plugin is rejected. Standard primitives have a separate namespace; `block.props.ref` always names an inline definition.

`slots` maps names to descriptors. Supported `type` values: `string`, `number`, `integer`, `boolean`, `object`, `array`, `component`. Descriptors support `description`, `required`, `default`, `enum`; strings support `minLength`, `maxLength`, `maxWords`, `oneLine`; numbers support `minimum`/`maximum`; arrays support `items`, `minItems`/`maxItems`; objects support named `properties` with the same descriptors. Unknown invocation slots and unknown declared-object properties are errors.

A slot may also declare a `role` — `actionTitle`, `takeaway`, `source`, `tracker` or `footer`. A role says what the content is for so a quality profile can require it (a source under every chart) or measure it (an action title's line count); the theme only styles it, and no role adds a requirement on its own. The `consulting-deck` PPTX profile requires `takeaway` and `source` and bounds the `actionTitle` at two lines; the default profiles ask for nothing. Profile findings are warnings that advise by default and block only under a quality policy gate; a slot the definition itself marks `required` is a validation error regardless of profile.

Defaults apply only to missing values, including nested object properties. Empty strings, empty lists and `false` remain authored values; they do not select defaults. `required` rejects missing values; use `minLength`/`minItems` to reject empty content. Optional bindings omit undefined properties. `$if` treats missing, null, empty strings/lists and false as absent, after defaults resolve. Required-slot validation runs before omission, so optional groups cannot bypass requirements.

An invocation accepts only `ref` and `slots`, with no layout overrides. Component slots accept existing primitives or registered plugin components. They reject placement props `x`, `y`, `w`, `h`, `position`, `grid`, `alignment`, `spacing` and, on a group, `gridConfig`, `direction`, `gap`, `weights`; intrinsic image `width`/`height` remain valid. Placement and typography belong in the definition. Direct primitive authoring remains available outside semantic invocations.

## Editor assistance

Block bodies, section headers/footers, and nested `$if`/`$each` compositions use schemas derived from the selected renderer and registered plugins, in both formats. The playground suggests component names, component props and binding directives, and accepts bindings in nested property values. Ordinary document props keep their literal-value schemas. Component names remain literal discriminators; use a component slot when supplying a whole component dynamically.

Invocations complete against the document being edited. The editor reads `props.blocks` from the text as it is (a half-typed definition is simply not offered yet) and installs a schema that names those definitions: `ref` completes the defined names with their descriptions, `slots` completes the selected block's slots with each slot's description, default and contract (required, word budget, one line, bounds, role), a component slot completes against the renderer's slide or section content, and mistakes are flagged inline with the verdict the runtime reaches — an unknown reference, a missing required slot, an undeclared slot, a value of the wrong type, a multi-line value in a one-line slot, or placement smuggled into a component slot.

Reference blocks — every definition of every document the server discovers, the shipped playground templates included — are offered too. At `ref`, a reference the document does not define yet inserts its definition (and the definitions it depends on) into `props.blocks` in the same edit, so no reference is left unresolved. Wherever a slide, a group or a section takes content — an empty object, a `name` being typed, an empty `children` array — every block is offered as a snippet: a complete invocation at typical slot cardinality (the source document's own invocation when it makes one), its text slots as tab stops, its definition brought along when missing. The same catalog is served at `GET /api/discovery/blocks` and written into the AI assistant's PPTX prompt.

Autocomplete follows the expected value type, including unions and referenced plugin schemas:

| Expected value    | Additional directives                              |
| ----------------- | -------------------------------------------------- |
| Number or integer | `$count`, `$measure`                               |
| String            | `$join`                                            |
| Array             | `$each`, with its template typed as one array item |
| Object or boolean | References and `$if` only                          |

`$slot`, `$item`, `$theme`, `$context` and `$if` can supply any compatible value. Their `default`, `then` and `else` values retain the surrounding type. Starting a normal property hides whole-object directive alternatives; selecting a directive offers only its own options. A directive object cannot mix those options with ordinary component props.

Inside arrays, `$if` and `$each` may also insert a sequence of items. This is how a block body can repeat components; it does not make `$each` valid as the entire object-valued `props`. Evaluated values still pass runtime type, constraint and placement validation.

## Bounded bindings

Bindings use JSON Pointers, including `~0`/`~1` escaping. Directive objects accept only the fields listed below; they never execute JavaScript or load code.

| Directive                                                  | Meaning                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "$slot": "/title", "default": "..." }`                  | Slot value; optional fallback if missing. For a component slot, `props: { ... }` merges beneath the slot value's own props: placement and styling defaults live here, and the slot content overrides styling but never placement.                         |
| `{ "$theme": "/styles/label/size", "default": 10 }`        | Resolved theme token; missing token without fallback is an error.                                                                                                                                                                                         |
| `{ "$context": "/document/title" }`                        | General engine context: document metadata, page width/height in twips, current section tracker in chrome, and `/sources` — every distinct `source`-role slot value in the document, in order.                                                             |
| `{ "$if": "/source", "then": [...], "else": [...] }`       | Select by presence; selected sequences splice into the surrounding sequence. `else` is optional.                                                                                                                                                          |
| `{ "$each": "/items", "template": { ... } }`               | Repeat one template value per item. `$item` binds the current item. Use a `group` for multiple flow children. A repeated element maps back to the item that produced it.                                                                                  |
| `{ "$item": "/label" }` or `{ "$item": "" }`               | Current repeated item field, or the whole item; optional `default`.                                                                                                                                                                                       |
| `{ "$count": "/items" }`                                   | Array length, e.g. the number of equal-width columns.                                                                                                                                                                                                     |
| `{ "$each": { "$item": "/cells" }, ... }`                  | `$if`, `$each` and `$count` take an operand: a slot pointer, or one reference — `{ "$item": ... }` for the current repeated item's own field or array, `{ "$slot": ... }`, `{ "$context": ... }`. A table repeats its columns, and each column its cells. |
| `{ "$join": [...], "separator": " ", "keepEmpty": false }` | Join scalar bindings; omitted values collapse unless `keepEmpty` is true.                                                                                                                                                                                 |
| `{ "$measure": "width", "fraction": 0.5, "unit": "twip" }` | Current section body width/height; fraction 0–1, units `pt` (default), `twip`, `in`.                                                                                                                                                                      |

DOCX repetition adapts content through ordinary flow/columns without shrinking typography. The complete playground template `client-report-blocks.docx.json` demonstrates two to four metrics using `$count`/`$each`, optional source text whose divider and spacing disappear together, and a table whose columns repeat over a slot and whose cells repeat over each column's own array. Bounds are explicit slot constraints and primitive dimension constraints. Unsupported count/text overflow is a hard error; automatic font shrinking and general expressions are not supported. Explicit blank paragraphs/spacers reserve space deliberately.

## Section state

A DOCX definition may declare `section: { tracker?, header?, footer?, pageBreak?, scope? }`. Author invocations with section effects directly in a top-level section body. Nested composition may pass through transparent groups, but cannot install section state from columns, table cells or header/footer regions.

The engine resolves local trackers before chrome. `scope: "following"` carries the declared header/footer effect to later sections; default scope is local. Header/footer bindings see the receiving section’s page dimensions and `/section/tracker`, while retaining the declaring invocation’s slots. Last local tracker/chrome declaration wins. Explicit section `header`, `footer` and `pageBreak` take precedence. Chrome defaults to a section page break; explicit `false` remains respected. Existing `{PAGE}` / `{NUMPAGES}` paragraph fields stay native Word fields.

The playground demonstrates `cover`, `key-takeaways`, `section-opener`, `running-head`, `kpi-row`, `callout`, `data-table`, `chart-figure`, `figure`, `footnotes` and the `source-line` the data and figure blocks invoke. These are names in that document, not registered engine components. General document operations remain engine code; visual compositions remain JSON.

### The report blocks

Every definition in `client-report-blocks.docx.json` binds its sizes and colours to the theme's type roles and chrome recipes with a safe default, so the same JSON renders on every bundled theme; the previews below are the house theme, rendered through LibreOffice.

| Block            | Slots                                                                                                     | What the definition decides                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cover`          | title, subtitle, client, date, confidentiality, logo                                                      | The cover recipe's rule 30% down the page; the eyebrow, display and label roles                                                                                                                                                                                                           |
| `key-takeaways`  | label, items 3–5 of ≤ 25 words                                                                            | The key-takeaways recipe's rule, label role, hairline                                                                                                                                                                                                                                     |
| `section-opener` | number, title, tracker                                                                                    | Eyebrow number, a real level-1 heading, the section tracker the running head reads                                                                                                                                                                                                        |
| `running-head`   | title, tracker, confidentiality, date, pageNumbers                                                        | Header `title · tracker` and footer `confidentiality · n / N · date` in the tracker and footer roles, inherited by later sections                                                                                                                                                         |
| `kpi-row`        | items 2–4 of value, unit, label, delta, trend; source                                                     | Equal columns of `statistic`, the delta and its glyph beside the figure, a sourced hairline that collapses with the source                                                                                                                                                                |
| `callout`        | label (default "Note"), text ≤ 60 words                                                                   | One hairline down the left in the theme rule colour, no fill; the label role over body text                                                                                                                                                                                               |
| `data-table`     | title, labelHeader, labels 1–24, columns 1–6 of header, cells 1–24, numeric (default true); notes, source | A label column, then data columns right-aligned header and cells; the row bound keeps the table on one page with its header; notes and source through the shared `source-line` block. Rounding stays the author's, and `W_QUALITY_TABLE_MIXED_DECIMALS` reports a slip at the column slot |
| `chart-figure`   | chart (component: `highcharts`, or `chart` on office-open), caption, takeaway, source (required)          | The chart as given; `**Figure {SEQ:figure}.** caption` in the label role; the takeaway beneath in the quote role; the source through `source-line`. The block's `takeaway` and `source` slots are what `W_QUALITY_CHART_ANNOTATION` reads, so a chart placed here is annotated by them    |
| `figure`         | image (component: `image` or `visual`), caption, source                                                   | The same numbered caption over the same `figure` sequence, so figures and charts number together; source through `source-line`                                                                                                                                                            |
| `footnotes`      | title (default "Notes and sources")                                                                       | Nothing unless the document cites a source; otherwise a hairline, the title in the label role and a numbered list of every distinct `source`-role slot value in document order, from the engine's `/sources` context                                                                      |

![kpi-row on consulting](/blocks/kpi-row-consulting.png)

![callout on consulting](/blocks/callout-consulting.png)

![data-table on consulting](/blocks/data-table-consulting.png)

![chart-figure on consulting](/blocks/chart-figure-consulting.png)

![figure on consulting](/blocks/figure-consulting.png)

![footnotes on consulting](/blocks/footnotes-consulting.png)

Two engine capabilities the figure blocks compose rather than implement. `{SEQ:name}` in any paragraph text is a Word `SEQ` field the compiler also counts, so `Figure {SEQ:figure}.` reads 1, 2, 3 in document order in Word, in headless LibreOffice and in the preview PDF alike (see [shared text features](/reference/docx/components#shared-text-features)). `/sources` in a DOCX block context is the list of every distinct `source`-role slot value across the document's invocations, in order; `{ "$each": { "$context": "/sources" } }` walks it, and each item maps back to the slot it was written in.

Word draws figures with the face's own digits: Arial, the house heading face a `statistic` figure is set in, has lining tabular figures, so a KPI row's values align without a font feature. The document model does not yet expose OpenType number spacing; a theme that sets a proportional-figure face for `stat` would not get tabular figures from this block.

## PPTX

A PPTX definition expands, at its invocation, into a transparent `group` of positioned slide content. A block is invoked as a slide child, beside coordinate-authored components; the definition owns every coordinate, and an invocation that states any is rejected. What the body can use beyond the content components:

| Operation            | Where                                             | Meaning                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame                | `group` with `x`/`y`/`w`/`h` or `grid`            | A nested coordinate system: children position relative to the frame, and an omitted `x`/`y` or `w`/`h` means the frame's. See [Slides & the grid](/reference/pptx/slides-and-grid#groups-and-frames).                                                                                                         |
| Distribution         | `group` with `direction`, `gap`, `weights`        | Children take equal or weighted cells along the axis. An `$each` template inside a row redistributes for two, three or four items; an `$if` child that collapsed is not counted, so nothing reserves its space.                                                                                               |
| Nested grid          | `group.gridConfig`, `slide.grid`                  | Grid placements inside the group resolve against this config, merged over the enclosing grid. A definition's `slide.grid` becomes the config of the group it expands into.                                                                                                                                    |
| Component-slot props | `{ "$slot": "/chart", "props": { ... } }`         | The definition's frame and styling defaults for a component slot, merged beneath the slot content's own props. The content may not carry `x`, `y`, `w`, `h`, `position` or `grid`; intrinsic data such as chart data or image dimensions stays valid.                                                         |
| Bounded fit          | `text.fit: { maxLines?, shrink? }`                | Lines are estimated with the width model at the effective size; past `maxLines`, or the box height, the text steps down through the declared `shrink` sizes and takes the first that fits. Nothing else is tried: when no declared size fits, generation fails with `text_fit_overflow` at the authored slot. |
| Slide effects        | `slide: { background?, notes?, grid? }`           | Background and notes fill in what the invoking slide did not state; a slide that states its own keeps it; among several blocks on one slide the last declaration wins. Requires the block to be invoked directly on a slide, transparent groups excepted (`invalid_placement` otherwise).                     |
| `$theme`             | `/styles/display/fontSize`, `/palette/rule`, …    | The resolved theme, type roles projected onto `styles`. Bind sizes with a `default` so a definition renders on a theme that declares no roles.                                                                                                                                                                |
| `$context`           | `/document/title`, `/slide/width`, `/slide/index` | Deck metadata (`title`, `author`, `subject`, `company`) and the invoking slide's canvas in inches and 1-based authored index.                                                                                                                                                                                 |
| `$measure`           | `width` / `height`, units `pt` (default), `in`    | The slide canvas.                                                                                                                                                                                                                                                                                             |

`section` is DOCX-only and `slide` is PPTX-only; each is a `block_format` error in the other format. The rest of the contract — slots, defaults, `$if`, `$each`, `$join`, budgets, provenance, plugin composition, recursion limits — is the same in both formats.

The complete playground template `consulting-deck-blocks.pptx.json` carries the `action-chart` definition: an action title bound to the `display` role with `fit: { maxLines: 2, shrink: [24, 22] }`, a chart slot framed by the definition and painted from the theme series, an optional takeaway beside it under an accent rule, an optional source beneath whose hairline collapses with it, a tracker and a page number. Every size binds to a type role with a safe default, so the same definition renders on every bundled theme; the `consulting-deck` profile is what asks for the takeaway and the source. Copy it from `jto://blocks` (or from the deck) into `props.blocks`, then invoke it:

```json
{
  "name": "block",
  "props": {
    "ref": "action-chart",
    "slots": {
      "title": "Revenue grew 18% as on-time delivery reached 94% of contracted work",
      "tracker": "Performance",
      "chart": {
        "name": "chart",
        "props": {
          "type": "bar",
          "valAxisTitle": "Revenue (€m)",
          "data": [
            {
              "name": "Revenue",
              "labels": ["Q1", "Q2", "Q3", "Q4"],
              "values": [4.2, 4.6, 5.1, 5.6]
            }
          ]
        }
      },
      "takeaway": "Reliability, not price, drove the gain.",
      "source": "Source: quarterly operating review, 2026."
    }
  }
}
```

Both renderer profiles draw the expanded primitives: `pptxgenjs` and `office-open` see the same groups flattened into slide elements, and a backend that lacks a capability the expanded content needs (a bubble chart on `office-open`) says so with the same `unsupported_renderer_feature` diagnostic it gives coordinate-authored content — never by waiving the block.

### Breaking changes

Slide templates are gone: the root `templates` array, the slide `template` and `placeholders` props, the `layout` prop, the `MISSING_TEMPLATE`, `UNKNOWN_PLACEHOLDER` and `PLACEHOLDER_NO_POSITION` warnings, and the `masters`/`placeholders` renderer capabilities. A template becomes a definition with `slide.background` and its objects as `body`; a slide that used it invokes the block as its first child; a placeholder becomes a slot, its `defaults` the `props` merged beneath the slot. No aliases or migration layer exist. The three shipped playground decks are converted; the corpus template cases are replaced by block cases with new goldens.

## Composition, validation and inspection

Bodies can invoke other document-local blocks or explicitly registered code plugins. Plugins can emit blocks or primitives. Missing registrations produce validation errors; references do not install dependencies. Emitted components pass through standard DOCX validation. Expansion is deterministic for JSON-only blocks, with a 64-level / 50,000-node evaluator limit and a 64-level / 100,000-node combined plugin traversal limit. Cycles stop at these limits with `block_expansion_limit`.

Definition errors point into `/props/blocks/<name>`. Content errors and generated-node quality findings map to authored invocations/slots, including nested and repeated expansion. `jto_validate` with `includeCompiled: true` returns the primitive tree and source map. The plugin generator’s `expandStandardDefinition()` exposes its source map too.

`jto://blocks` provides definitions, derived slot schemas, budgets and source-template pointers for agentic authoring, in both formats. Copy selected definitions and any transitive block dependencies into `props.blocks`. The catalog does not register runtime names. Use `jto_workspace_inspect` with `paths: ["/props/blocks"]` to read actual definitions at a workspace revision; `includeBlocks: true` adds definition-derived slot schemas and invocation fill pointers; no catalog entry is inserted into the document implicitly.

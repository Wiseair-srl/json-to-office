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

A slot may also declare a `role` — `actionTitle`, `takeaway`, `source`, `tracker` or `footer`. A role says what the content is for so a quality profile can require it (a source under every chart) or measure it (an action title's line count); the theme only styles it, and no role adds a requirement on its own. The `consulting-deck` PPTX profile requires `takeaway` and `source` and bounds the `actionTitle` at two lines; the default profiles ask for nothing.

Defaults apply only to missing values, including nested object properties. Empty strings, empty lists and `false` remain authored values; they do not select defaults. `required` rejects missing values; use `minLength`/`minItems` to reject empty content. Optional bindings omit undefined properties. `$if` treats missing, null, empty strings/lists and false as absent, after defaults resolve. Required-slot validation runs before omission, so optional groups cannot bypass requirements.

An invocation accepts only `ref` and `slots`, with no layout overrides. Component slots accept existing primitives or registered plugin components. They reject placement props `x`, `y`, `w`, `h`, `position`, `grid`, `alignment`, `spacing`; intrinsic image `width`/`height` remain valid. Placement and typography belong in the definition. Direct primitive authoring remains available outside semantic invocations.

## Editor assistance

Block bodies, section headers/footers, and nested `$if`/`$each` compositions use schemas derived from the selected renderer and registered plugins. The playground suggests component names, component props and binding directives, and accepts bindings in nested property values. Ordinary document props keep their literal-value schemas. Component names remain literal discriminators; use a component slot when supplying a whole component dynamically.

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

| Directive                                                  | Meaning                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "$slot": "/title", "default": "..." }`                  | Slot value; optional fallback if missing. For a component slot, `props: { ... }` merges beneath the slot value's own props: placement and styling defaults live here, and the slot content overrides styling but never placement. |
| `{ "$theme": "/styles/label/size", "default": 10 }`        | Resolved theme token; missing token without fallback is an error.                                                                                                                                                                 |
| `{ "$context": "/document/title" }`                        | General engine context: document metadata, page width/height in twips, current section tracker in chrome.                                                                                                                         |
| `{ "$if": "/source", "then": [...], "else": [...] }`       | Select by slot presence; selected sequences splice into the surrounding sequence. `else` is optional.                                                                                                                             |
| `{ "$each": "/items", "template": { ... } }`               | Repeat one template value per item. `$item` binds the current item. Use a `group` for multiple flow children.                                                                                                                     |
| `{ "$item": "/label" }` or `{ "$item": "" }`               | Current repeated item field, or the whole item; optional `default`.                                                                                                                                                               |
| `{ "$count": "/items" }`                                   | Array length, e.g. the number of equal-width columns.                                                                                                                                                                             |
| `{ "$join": [...], "separator": " ", "keepEmpty": false }` | Join scalar bindings; omitted values collapse unless `keepEmpty` is true.                                                                                                                                                         |
| `{ "$measure": "width", "fraction": 0.5, "unit": "twip" }` | Current section body width/height; fraction 0–1, units `pt` (default), `twip`, `in`.                                                                                                                                              |

DOCX repetition adapts content through ordinary flow/columns without shrinking typography. The complete playground template `client-report-blocks.docx.json` demonstrates two to four metrics using `$count`/`$each`, plus optional source text whose divider and spacing disappear together. Bounds are explicit slot constraints and primitive dimension constraints. Unsupported count/text overflow is a hard error; automatic font shrinking and general expressions are not supported. Explicit blank paragraphs/spacers reserve space deliberately.

## Section state

A DOCX definition may declare `section: { tracker?, header?, footer?, pageBreak?, scope? }`. Author invocations with section effects directly in a top-level section body. Nested composition may pass through transparent groups, but cannot install section state from columns, table cells or header/footer regions.

The engine resolves local trackers before chrome. `scope: "following"` carries the declared header/footer effect to later sections; default scope is local. Header/footer bindings see the receiving section’s page dimensions and `/section/tracker`, while retaining the declaring invocation’s slots. Last local tracker/chrome declaration wins. Explicit section `header`, `footer` and `pageBreak` take precedence. Chrome defaults to a section page break; explicit `false` remains respected. Existing `{PAGE}` / `{NUMPAGES}` paragraph fields stay native Word fields.

The playground demonstrates `cover`, `key-takeaways`, `section-opener`, `running-head`, and `metric-row`. These are names in that document, not registered engine components. General document operations remain engine code; visual compositions remain JSON.

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
| `$measure`           | `width` / `height`, units `in` (default), `pt`    | The slide canvas.                                                                                                                                                                                                                                                                                             |

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

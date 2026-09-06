# JSON blocks

Blocks compose reusable document structure from JSON. Code plugins provide calculations, external I/O and programmable behavior. DOCX supports the contract below. Format is inherited from the containing document. PPTX definitions share the same slot and binding model but cannot yet be rendered.

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

`props.blocks` maps names (`^[a-zA-Z][a-zA-Z0-9_-]*$`) to `{ description?, slots, body, section? }`. Definitions belong to one document and inherit its format; no `format` property is accepted. The selected renderer determines available components and operations. A name conflicting with a registered plugin is rejected. Standard primitives have a separate namespace; `block.props.ref` always names an inline definition.

`slots` maps names to descriptors. Supported `type` values: `string`, `number`, `integer`, `boolean`, `object`, `array`, `component`. Descriptors support `description`, `required`, `default`, `enum`; strings support `minLength`, `maxLength`, `maxWords`, `oneLine`; numbers support `minimum`/`maximum`; arrays support `items`, `minItems`/`maxItems`; objects support named `properties` with the same descriptors. Unknown invocation slots and unknown declared-object properties are errors.

Defaults apply only to missing values, including nested object properties. Empty strings, empty lists and `false` remain authored values; they do not select defaults. `required` rejects missing values; use `minLength`/`minItems` to reject empty content. Optional bindings omit undefined properties. `$if` treats missing, null, empty strings/lists and false as absent, after defaults resolve. Required-slot validation runs before omission, so optional groups cannot bypass requirements.

An invocation accepts only `ref` and `slots`, with no layout overrides. Component slots accept existing primitives or registered plugin components. They reject placement props `x`, `y`, `w`, `h`, `position`, `grid`, `alignment`, `spacing`; intrinsic image `width`/`height` remain valid. Placement and typography belong in the definition. Direct primitive authoring remains available outside semantic invocations.

## Editor assistance

Block bodies, section headers/footers, and nested `$if`/`$each` compositions use schemas derived from the selected renderer and registered plugins. The playground suggests component names, component props and binding directives, and accepts bindings in nested property values. Ordinary document props keep their literal-value schemas. Component names remain literal discriminators; use a component slot when supplying a whole component dynamically.

## Bounded bindings

Bindings use JSON Pointers, including `~0`/`~1` escaping. Directive objects accept only the fields listed below; they never execute JavaScript or load code.

| Directive                                                  | Meaning                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `{ "$slot": "/title", "default": "..." }`                  | Slot value; optional fallback if missing.                                                                     |
| `{ "$theme": "/styles/label/size", "default": 10 }`        | Resolved theme token; missing token without fallback is an error.                                             |
| `{ "$context": "/document/title" }`                        | General engine context: document metadata, page width/height in twips, current section tracker in chrome.     |
| `{ "$if": "/source", "then": [...], "else": [...] }`       | Select by slot presence; selected sequences splice into the surrounding sequence. `else` is optional.         |
| `{ "$each": "/items", "template": { ... } }`               | Repeat one template value per item. `$item` binds the current item. Use a `group` for multiple flow children. |
| `{ "$item": "/label" }` or `{ "$item": "" }`               | Current repeated item field, or the whole item; optional `default`.                                           |
| `{ "$count": "/items" }`                                   | Array length, e.g. the number of equal-width columns.                                                         |
| `{ "$join": [...], "separator": " ", "keepEmpty": false }` | Join scalar bindings; omitted values collapse unless `keepEmpty` is true.                                     |
| `{ "$measure": "width", "fraction": 0.5, "unit": "twip" }` | Current section body width/height; fraction 0–1, units `pt` (default), `twip`, `in`.                          |

DOCX repetition adapts content through ordinary flow/columns without shrinking typography. The complete playground template `client-report-blocks.docx.json` demonstrates two to four metrics using `$count`/`$each`, plus optional source text whose divider and spacing disappear together. Bounds are explicit slot constraints and primitive dimension constraints. Unsupported count/text overflow is a hard error; automatic font shrinking and general expressions are not supported. Explicit blank paragraphs/spacers reserve space deliberately.

## Section state

A DOCX definition may declare `section: { tracker?, header?, footer?, pageBreak?, scope? }`. Author invocations with section effects directly in a top-level section body. Nested composition may pass through transparent groups, but cannot install section state from columns, table cells or header/footer regions.

The engine resolves local trackers before chrome. `scope: "following"` carries the declared header/footer effect to later sections; default scope is local. Header/footer bindings see the receiving section’s page dimensions and `/section/tracker`, while retaining the declaring invocation’s slots. Last local tracker/chrome declaration wins. Explicit section `header`, `footer` and `pageBreak` take precedence. Chrome defaults to a section page break; explicit `false` remains respected. Existing `{PAGE}` / `{NUMPAGES}` paragraph fields stay native Word fields.

The playground demonstrates `cover`, `key-takeaways`, `section-opener`, `running-head`, and `metric-row`. These are names in that document, not registered engine components. General document operations remain engine code; visual compositions remain JSON.

## Composition, validation and inspection

Bodies can invoke other document-local blocks or explicitly registered code plugins. Plugins can emit blocks or primitives. Missing registrations produce validation errors; references do not install dependencies. Emitted components pass through standard DOCX validation. Expansion is deterministic for JSON-only blocks, with a 64-level / 50,000-node evaluator limit and a 64-level / 100,000-node combined plugin traversal limit. Cycles stop at these limits with `block_expansion_limit`.

Definition errors point into `/props/blocks/<name>`. Content errors and generated-node quality findings map to authored invocations/slots, including nested and repeated expansion. `jto_validate` with `includeCompiled: true` returns the primitive tree and source map. The plugin generator’s `expandStandardDefinition()` exposes its source map too.

`jto://blocks` provides definitions, derived slot schemas, budgets and source-template pointers for agentic authoring. Copy selected definitions and any transitive block dependencies into `props.blocks`. The catalog does not register runtime names. Use `jto_workspace_inspect` with `paths: ["/props/blocks"]` to read actual definitions at a workspace revision; `includeBlocks: true` adds definition-derived slot schemas and invocation fill pointers; no catalog entry is inserted into the document implicitly.

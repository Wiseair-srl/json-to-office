---
'@json-to-office/shared-pptx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared': minor
'@json-to-office/jto': patch
'@json-to-office/mcp-server': patch
---

Make the published PPTX schema and the PPTX validator ask for the same `props`. The generated document schema marked `props` required on every component, including `slide`, whose props are all optional — so `{ "name": "slide", "children": [...] }`, a slide that validates and renders, was flagged by every editor and agent reading that schema. In the other direction the deep validator accepted a bare `{ "name": "text" }`: `text` and `runs` are both optional fields, so an empty props object passed and a missing one passed with it, and the component that exists to draw content was allowed to carry none.

Requiredness is now one answer per component, held in the registry and read by the schema generator and the deep walk alike: `slide` may omit `props`; every other PPTX component — the `pptx` root, `text`, `image`, `shape`, `table`, `highcharts`, `chart` — must carry it, and its absence is reported as `required_property` at that node's `/props` pointer instead of passing silently.

**Behaviour change.** Documents that already write `props` everywhere are unaffected. Documents that omitted it on a `text` or an `image` are not: generation runs the deep validator, so those used to produce a file — a slide with nothing drawn on it — and now fail validation with a pointer to the node. That is the intended outcome for `text`, whose whole purpose is the content the key carries; `image` follows because the published schema has required `props` there since it was first generated, and reading the schema's own answer instead would have loosened that contract rather than fixed the disagreement. `image` remains half enforced: the missing key is caught, an empty `"props": {}` is not, since a sourceless image is an `IMAGE_NO_SOURCE` warning at generation rather than an error.

Three smaller divergences on the same key close with it. `"props": null` was read as an omission by the nested walk — in both formats — while the schema typed the key as an object; it is now reported as a type error at the key it was written on. A slide's `placeholders` record accepted the whole component union, so a `slide`, or the `pptx` root, could sit in a title slot: placeholder values are narrowed to what a slide's `children` accept, in the schema and the walk together, and `jto_describe_component` now names those six components in the slot's schema instead of every component there is. And a registered plugin component may no longer omit `props`, which the published plugin branch has always required — the walk checks the key's presence and leaves its contents to the plugin layer, so the failure arrives as `required_property` at the node rather than as "expected object" from inside the plugin check.

The generated schemas also declare `$schema` as `http://json-schema.org/draft-07/schema#`, draft-07's own `$id`. The previous `https://` spelling read as an unknown dialect, so a consumer had to rewrite the field or pass `validateSchema: false` before a stock Ajv would compile the schema at all.

Released as a minor rather than a major deliberately: every document the validator starts rejecting was already invalid against the published JSON Schema for that component, so this brings the runtime into line with the contract it documents rather than changing that contract. The one contract that does change — `slide`'s `props` becoming optional — only accepts more.

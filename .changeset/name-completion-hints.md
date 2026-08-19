---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': patch
'@json-to-office/shared-pptx': patch
'@json-to-office/jto': patch
---

Exported component unions are now canonical if/then discriminated unions —
fixing both component-name autocomplete and union diagnostics.

Monaco / VS Code resolve a partially-typed node against a flat `anyOf` by
keeping the single best-matching branch. While typing `{ "name": | }`, every
branch requiring `props` failed validation, so its name never reached
autocomplete (a section's children suggested only `image`, `text-box`, `toc`),
and diagnostics reported one arbitrary branch's complaints — `Missing property
"props"` plus `Value must be "heading"` — instead of the real problem.

`restructureNameDiscriminatedUnions` (new export from `@json-to-office/shared`,
applied inside both `convertToJsonSchema` implementations, JSON-Schema export
only — runtime TypeBox validation is untouched) rewrites each
name-discriminated union into `properties.name` (the discriminator enum, with
per-component descriptions) plus `allOf[].if/then` dispatch. The accepted
document set is exactly the same — verified by parity tests and ajv over all
shipped templates — but editors now behave deterministically:

- completing `name` offers every legal component, with its description
- an empty component reports only `Missing property "name"`
- an empty or wrong name reports only `Value is not accepted. Valid values: …`
- a valid name activates exactly its branch for keys, props and errors

`unionBranches` (also exported) iterates branch objects shape-agnostically for
consumers that post-process them. Standard component branches additionally
carry their registry `description`. Versioned plugin branches stay grouped in
a small `anyOf` inside their `then`.

Plugin toggles also round-trip exactly: the playground sends its selection as
an explicit `plugins=` query (empty means "no plugins") and the discovery
endpoint honors it, instead of treating an empty selection as "all registered
plugins". Only a missing param still falls back to everything.

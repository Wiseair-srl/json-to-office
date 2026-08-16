---
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': patch
'@json-to-office/core-docx': patch
'@json-to-office/jto': patch
---

Say "component" everywhere; drop the last traces of the old `modules` format.

The JSON tree has one node kind — `{ name, props, children? }` — in two
flavours, base and custom. But an earlier format nested `modules` inside
`modules`, and its vocabulary outlived it. The README and the architecture guide
both opened by describing documents as "a tree of **modules**, each module
containing base components", a hierarchy that no longer exists and that the code
sample directly beneath contradicted. Schema descriptions called section
header/footer arrays "modules", and a validation hint told authors to check
their "module type" — a phrase they would find nowhere in the schema. All of
these now say component, matching what the validator actually reports.

Two dead things went with it. `DOC_LINKS` is **removed** from the
`@json-to-office/shared-docx` public surface: it was consumed nowhere, and all
three of its URLs pointed at a `json-to-docx.com` docs domain the project no
longer uses. `core-docx`'s `examples/test-spacing-debug.ts` is deleted — it was
written in the superseded `type`/`config`/`modules` shape, so it could not
render against the current parser, yet still compiled as part of the package.

The error-message change is behavioural, not just cosmetic: the generic
union catch-all detector in both deep validators matched
`/invalid (component|module) configurations?/`, and the union-array hint
branched on `path?.includes('modules')`. No message producer has emitted
"module" for some time and no path segment is named `modules`, so both branches
were unreachable; they now match only what is actually emitted.

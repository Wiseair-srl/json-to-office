---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto': patch
---

docx validation gets one source of truth for validity (#292). The deep walk's
embedded-component positions (section header/footer, table cell content) are
now declared on `STANDARD_COMPONENTS_REGISTRY` entries and the walk is driven
from those declarations, with a test pinning them to the `createPropsSchema`
factories that wire the same positions into the live document schema.

The flip-to-valid rescue no longer fails open: when the whole-document check
rejects and the walk finds nothing, the document is accepted only for the
three audited false-reject classes (`allowUnknownFields`, documents that use a
registered plugin component, and `allowedChildren` containment — verified
precisely against a containment-relaxed schema); anything else now fails
closed. Unknown or wrong-typed keys next to `name`/`props`/`children` (a
`bogus: 1`, an `enabled: "yes"`) — previously accepted silently, even inside
section headers — are rejected with a path-addressed error, and a new guard test
sweeps every closed object position of every component's props asserting
validate, validateStrict and generation agree on rejecting unknown keys.

The jto server now reads the document title for filenames from
`props.metadata.title` (docx) / `props.title` (pptx) instead of a root-level
`metadata` that was never part of the schema — real playground documents had
always fallen back to the generic filename. Because that is the first time
user-authored text reaches the filename, the title is sanitized where the name
is built: path separators and control characters are replaced and the length is
capped, on both the generated and the cache-hit branch. The filename travels
into the generate response and into the `Content-Disposition` of
`/preview/*-from-json`, which interpolates it verbatim, so an unescaped CR/LF
in a title would otherwise have split that header.

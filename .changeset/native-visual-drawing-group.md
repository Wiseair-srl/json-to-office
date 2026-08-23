---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
---

A DOCX `visual` can now be drawn natively, as a Word drawing group

**New**

`visual.props.renderMode: "native"`, on a document with
`"renderer": "office-open"`, draws the canvas as one DrawingML group
(`wpg:wgp`) instead of rasterizing it: shapes become `wps:wsp` preset
geometry, text becomes real text boxes, and images become native pictures with
SVGs kept vector. The text stays searchable and every object stays editable in
Word, output for text- and shape-heavy graphics is smaller, and no PPTX, PNG or
rasterization service is involved anywhere in the path — a document whose
visuals are all native generates with `services` omitted entirely.

Placement is unchanged from the raster form: `width`, `height`, `alignment`,
`caption`, `alt`, `spacing`, `floating`, `keepNext` and `keepLines` all behave
as they do for an image, and captions remain ordinary paragraphs outside the
drawing. Geometry is inches or a percentage of the canvas; array order is
z-order; a canvas background colour or image becomes the bottom-most object.

Native mode is deliberately strict. Its element model is `text`, `shape` and
`image`, and every native props schema rejects unknown properties, so a
gradient fill, a `chart` element or a `dpi` that could not take effect is a
validation error naming the exact path rather than a silently missing object.
`renderMode: "native"` under any other renderer is reported at the component's
own `props/renderMode`, and the compiler's new `drawing-groups` capability
means IR that reaches `docxjs` by another route is refused before any bytes
exist instead of losing the graphic.

`docxPropsSchemaForRenderer` now takes the component name, so exported schemas
and editor autocomplete offer the raster shape alone under `docxjs` and both
shapes under `office-open`.

**Fixed**

Deep validation now resolves a union props schema to the branch the author
wrote against, so a bad property inside `visual.props.elements[2]` is reported
there rather than collapsing into one generic failure at `props`.

Both `visual.props` shapes are hoisted into their own JSON-Schema definitions
instead of being inlined at every position a component can appear. `visual` is
the largest props schema in the registry, and inlining a second one pushed the
exported `ComponentDefinition` deep enough that Ajv overflowed compiling it —
so `jto docx validate --schema` failed on any document with a `visual` in a
section header, footer or table cell, raster ones included. The exported schema
is now smaller than before this change.

**Unchanged**

An omitted `renderMode` still means `raster`, and every existing document
renders byte-for-byte as before.

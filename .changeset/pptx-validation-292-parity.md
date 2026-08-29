---
'@json-to-office/shared-pptx': minor
'@json-to-office/core-pptx': minor
---

pptx validation gets the #292 hardening the docx side shipped. The deep walk
(the only pptx validator — there is no whole-document stage behind it, so a
blind spot was accepted AND rendered) now types the component-object sibling
keys it previously only checked for presence: `enabled: "yes"`, `id: 7` and a
non-string `$schema` — at the root, on nested components, in placeholder
values, and a non-string `version` on plugin components — are rejected with
path-addressed errors instead of silently rendering.

The slide `placeholders` walk and props-strip are driven by the registry's
`hasPlaceholders` flag instead of a hardcoded `'slide'`, so a future component
whose published schema accepts placeholders is walked automatically. A new
guard test mirrors the docx one: every closed object position of every
component's props is swept with an unknown key, and every embedding position
with prop, sibling-key and wrong-typed-sibling defects, asserting validate,
validateStrict and generation agree on rejecting with localized errors.

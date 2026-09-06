---
'@json-to-office/quality': minor
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto': patch
---

Theme-aware consistency rules for DOCX (#332): `docx/type-scale` reports an authored size the theme never paints and snaps it to the nearest size on the theme's scale; `docx/size-count` caps the distinct sizes a document paints, blocks included; `docx/role-drift` reports a heading level or paragraph style painted at two sizes and restores the theme's size. All three are off on the default profile and enabled by `client-report`. Evidence names the expected value and whether it came from the theme or the profile. `QualityRule` gains `defaultEnabled`; the docx theme fact carries `typeScalePt` and `roleSizesPt`; `typeScaleSizes` lists a scale's steps.

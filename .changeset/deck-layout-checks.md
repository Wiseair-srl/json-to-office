---
'@json-to-office/quality': minor
'@json-to-office/shared': minor
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
---

Deck layout checks judge what the slide shows (#451, #452). `pptx/title-drift` compares each title's estimated first baseline and aligned edge (vertical anchor, fit size, insets, alignment) across blocks and hand-placed titles, keeps far placements apart, and names the titles that agree; certainty is now `estimated`. New `pptx/slide-footer` lets a profile require a page number or footer on block-built slides; `consulting-deck` requires the page number after the cover. Slots gain the `logo` role, chrome the safe area exempts; the consulting cover's logo takes it. Rule evidence names the layer that set what a finding measures (`profile`, `policy` or `rule`): `ResolvedQualityRuleConfiguration` carries `enabledSource` and `parameterSources`, `configurationSource`/`configurationLabel` are exported, and `sizeCountFinding` takes who set the ceiling instead of a profile id. Image-aspect findings in both formats and `pptx/safe-area` findings carry fixes where the repair is mechanical. Unstyled deck text in role drift and inline SVG aspect in decks are recorded as out of scope, with measurements.

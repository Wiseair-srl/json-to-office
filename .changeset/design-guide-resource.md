---
'@json-to-office/mcp-server': minor
'@json-to-office/quality': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

Discovery describes themes and a generated design guide (#333). Every built-in theme states `whenToUse` beside its voice; `jto_discover` lists themes as `{name, displayName, description, whenToUse, extended}` instead of bare names, and `jto://themes` carries each theme's typefaces, palette and, for an extended theme, its resolved type roles, scale, spacing, chrome recipes and motif. New `jto://guide/design/<format>` resources render the themes, quality profiles, rule pack, block catalogue and blueprints into one page from the registries `jto_validate` enforces; a drift test holds the guide, the catalogue and the resources together. `QualityRule` gains a required `description`, printed by the guide and pinned against the playground mirror. Server instructions point to the guide.

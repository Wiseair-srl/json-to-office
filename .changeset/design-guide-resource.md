---
'@json-to-office/mcp-server': major
'@json-to-office/quality': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
---

**Breaking (`@json-to-office/mcp-server`)**: `jto_discover`'s `formats[].themes` is now an array of theme objects rather than of names. A client that read it as `string[]` — `themes.includes(name)`, or passing an entry straight to the `theme` option — must read `themes[].name` instead. The names are unchanged and the tools still take a name. Kept as one field rather than added beside the old one: a theme an agent cannot describe is a theme it picks at random, which is what this release exists to stop.

Discovery describes themes and a generated design guide (#333). Every built-in theme states `whenToUse` beside its voice; `jto_discover` lists themes as `{name, displayName, description, whenToUse, extended}` instead of bare names, and `jto://themes` carries each theme's typefaces, palette and, for an extended theme, its resolved type roles, scale, spacing, chrome recipes and motif. New `jto://guide/design/<format>` resources render the themes, quality profiles, rule pack, block catalogue and blueprints into one page from the registries `jto_validate` enforces; a drift test holds the guide, the catalogue and the resources together. `QualityRule` gains an optional `description`, set on every built-in rule, printed by the guide and pinned against the playground mirror. Server instructions point to the guide.

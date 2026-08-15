---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': patch
---

fix(docx): stop the schema promising things the renderer does not do

**`text-box` `style.shading.fill` is now typed as a colour.** It was a bare `Type.String()`, but the value goes to `resolveColor`, which accepts `#RRGGBB` or a theme colour name and throws on everything else. Malformed fills therefore passed validation and blew up mid-render. `fill` now shares `HexColorSchema` with the border colours next to it, so those values are rejected up front — by `jto docx validate` and in the playground — instead of at generation time. Nothing that used to render stops rendering: `resolveColor` never accepted the newly rejected shapes (`rgb(…)`, `#abc`, digit-leading bare hex like `0F0FDF`) in the first place. If a document of yours starts failing validation here, it was already failing to generate.

**`toc` `numberingStyle` is documented as the no-op it is.** Word's table-of-contents field carries no numbering switch — entries inherit numbering from the heading styles they point at — so the renderer has never been able to apply this prop. It stays in the schema for compatibility, its description now says so, and setting it logs a warning during generation rather than being silently swallowed. Remove it from your documents; control TOC numbering through the heading styles instead.

`resolveColor` also accepts a bare 6-digit hex (`F0FDF4`). The shared colour pattern admits a letter-leading bare hex through its theme-name branch, so that shape used to validate and then throw mid-render; table cells and the chart palette already special-cased it. No theme colour name is six hex characters, so there is no ambiguity. `isValidColorName` / `getAvailableColorNames` now follow the reference chain too, so a token aliased to an unset slot is no longer reported as usable.

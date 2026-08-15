---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': patch
---

fix(docx): stop the schema promising things the renderer does not do

**`text-box` `style.shading.fill` is now typed as a colour.** It was a bare `Type.String()`, but the value goes to `resolveColor`, which accepts `#RRGGBB` or a theme colour name and throws on everything else. Malformed fills therefore passed validation and blew up mid-render. `fill` now shares `HexColorSchema` with the border colours next to it, so those values are rejected up front — by `jto docx validate` and in the playground — instead of at generation time. Nothing that used to render stops rendering: `resolveColor` never accepted the newly rejected shapes (`rgb(…)`, `#abc`, digit-leading bare hex like `0F0FDF`) in the first place. If a document of yours starts failing validation here, it was already failing to generate.

**`toc` `numberingStyle` is documented as the no-op it is.** Word's table-of-contents field carries no numbering switch — entries inherit numbering from the heading styles they point at — so the renderer has never been able to apply this prop. It stays in the schema for compatibility, its description now says so, and setting it logs a warning during generation rather than being silently swallowed. Remove it from your documents; control TOC numbering through the heading styles instead.

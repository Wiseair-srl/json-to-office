---
'@json-to-office/core-docx': patch
---

Two fixes to the inline escape pass, both found by review on #305.

An authored private-use character survives parsing. Each escape was swapped for
a bare character in U+E000–U+E006, and decoding mapped that whole range back
unconditionally — so text that already contained one of those codepoints came
back as a metacharacter, with no backslash anywhere in the input. An icon font
puts its glyphs in the private use area, which is how a document runs into
this. Substitutions are now a sentinel plus a marker, and the author's own
sentinels are guarded before the pass, so encoding is reversible.

An escape inside a link destination decodes. `parseInline` encodes before
`parseLinks` runs, and the captured target went into `target.url` untouched, so
`[x](https://host/a\_b)` put a private-use character in the URL that reached the
relationship. Destinations and cross-reference ids are now decoded at the link
boundary — the one place a target stops being parsed text.

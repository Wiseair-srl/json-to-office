---
'@json-to-office/shared': patch
---

Resolved font bytes now declare the family they were resolved as.

`ResolvedFont.family` was a claim about the bytes that nothing enforced. A host
— Core Text, fontconfig, GDI — finds a face by the family in its `name` table,
never by the registry entry or the filename, so a source whose name table says
something else is unreachable from every run that references it. It fails
silently: on a machine that has the real family installed the reference lands
there instead, and only a host without it shows the fallback.

Inter is the case that surfaced it. It resolves through an upstream override
that instances `InterVariable.ttf` per weight, and harfbuzz keeps the master's
name table — so every instance called itself "Inter Variable". The preview
stager renames a face only when the weight synthesizes a family of its own, so
"Inter Medium" and "Inter SemiBold" were saved on the way out while weights 400
and 700 — which ride the run's bold/italic toggles on the base family — were
staged under a name nothing asks for. In the preview container, which ships no
Inter, every paragraph without an explicit `fontWeight` rendered in a fallback
while the weighted ones came out correct.

`FontRegistry` now stamps each materialized source with the entry's family,
before validation and after the cache, so instanced bytes stay shareable across
families and no cached font is invalidated. Bytes that already answer to the
family — on either nameID 1 or nameID 16 — are passed through untouched.
Full and PostScript names take the face's RIBBI style as a suffix, so the four
faces of one family stay individually addressable rather than colliding on
"Inter" (two fonts sharing a PostScript name is malformed, and Core Text may
refuse the second registration).

`validateFontMetadata` gained a `FAMILY_MISMATCH` diagnostic for the same
mismatch, which now fires only when the repair could not run — a font with no
name table, a format-1 one, or non-sfnt bytes.

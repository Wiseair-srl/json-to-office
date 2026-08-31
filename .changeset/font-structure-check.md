---
'@json-to-office/shared': patch
---

Corrupt or truncated font bytes are now diagnosed instead of resolving
silently.

`detectFontFormat` classifies a buffer by its four magic bytes, so a download
truncated anywhere after byte four is still 'ttf' and flows on as if it were a
font. Nothing downstream noticed. `validateFontMetadata` had no name records to
check and usually no readable OS/2 either, so it stayed silent by design; the
family stamp found no declared family to contradict and no-opped; and the bytes
staged as a `.ttf` that fontconfig and Core Text refuse. The document rendered
in a fallback face with nothing anywhere saying why.

`FontRegistry` now runs a structural check first — valid sfnt header, table
directory within the buffer, `name` and `head` present, glyph outlines present
as `glyf` + `loca` or `CFF `, and a `name` table that actually yields records —
and reports the first failure as `FONT_UNREADABLE`, naming the face and what
about the file is wrong. On failure the family stamp and the metadata checks
are skipped rather than run against rubble; the source is still returned, since
this diagnoses the file rather than deciding for the caller whether to ship it.

Deliberately not a full sfnt parser: it answers "will a font system load this",
not "is this well-formed". Checksums, table contents and glyph data stay out of
scope, so a failure is always something that stops a face being indexed at all.

Raised in review of #307, which proposed reporting it through `FAMILY_MISMATCH`
instead. That was declined: a font with no family record isn't misnamed, it is
unusable, and reporting a file-integrity problem through the family-name
comparison would mislabel it — and would contradict the validator's documented
contract of staying quiet when it cannot substantiate a defect.

---
'@json-to-office/jto': patch
---

The preview now fetches a bold face for documents that ask for bold with
`bold: true`.

`collectReferencedWeights` narrows what the LibreOffice preview fetches to the
weights a document actually uses, but it only counted numeric `fontWeight`
values. `bold: true` is shorthand for `fontWeight: 700` — the schema says so and
the compiler resolves it that way — so a document that mixes the two lost its
bold face: referencing any numeric weight took it off the "no explicit weights"
fallback of {400, 700}, and nothing put 700 back. The bold runs then asked the
host for a face that was never staged, which renders as Inter on a machine with
Inter installed and as a fallback anywhere else — the preview container ships
only Liberation/Carlito/Caladea/DejaVu.

`bold: true` now counts as a reference to 700, with the compiler's own
precedence: a font that sets both takes the numeric weight, and its `bold` says
nothing about which face is wanted. `modern-annual-report-1` goes from fetching
Inter {400, 500, 600} to {400, 500, 600, 700}; that extra face per bold-using
family and cold cache is the cost of the bold text rendering at all.

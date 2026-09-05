---
'@json-to-office/mcp-server': patch
---

The judge can now be measured against itself, and the first look is not reassuring.

Every taste number this programme reports rests on one absolute verdict per document, which is worth exactly as much as its repeatability — a quantity nobody had measured. Four stored contact sheets from the cold baseline, re-judged a day later with the same rubric and the same model, changed three of four `wouldShip` answers. One of the three flipped to "would not ship" while the same call scored the document level 4 and genericness 1, its two best marks.

`pnpm rejudge <run-dir>` re-judges a recorded set from the contact sheets already on disk, so a full corpus costs one judge call per document and no authoring at all, and reports Cohen's kappa per rubric field. Kappa rather than agreement: on a corpus where four in five documents are unshippable, a judge that says no to everything agrees with itself 80% of the time and has said nothing.

If the spot check holds at n=40, the cold-versus-assisted comparison in §1 measures the judge and not the product, and the graded fields — which moved far less, none by more than one step — are the part worth keeping. The recorded baselines now carry that caveat.

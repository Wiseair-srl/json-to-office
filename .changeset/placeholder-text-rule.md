---
'@json-to-office/quality': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/mcp-server': minor
---

A document can no longer ship with its slots unfilled.

Both formats gain `placeholder-text`, one rule answering one question — is this text real yet? — over two codes, because the two answers have different consequences. `W_QUALITY_SCAFFOLD_MARKER` is a slot still holding the `{{…}}` marker a scaffold wrote into it: `jto_validate` lists the markers and still answers `ok: true`, because a draft is a legitimate thing to hold, while `jto_generate` now refuses the document with one path-addressed `E_SCAFFOLD_MARKER` error per remaining slot. `W_QUALITY_PLACEHOLDER_TEXT` is leftover filler — lorem ipsum, "Your title here", "Click to add title", a whole-string `[bracketed placeholder]`, bare `TODO`/`XXX` — and only ever advises: nobody put it there on purpose, and nobody but the author can be sure it is not the real copy.

The scan visits every string in the authored document rather than a list of text-bearing properties. An allowlist is the tidier thing to write and the wrong thing to ship: it drifts silently as components gain properties, and a marker it misses is a marker generation lets through. The patterns are narrow enough that a colour, a font family or a file path never matches one, and deliberate values authors do write — `TBD`, `N/A`, a citation like `[1]` — are not placeholders. Subtrees with `enabled: false` are skipped; they never reach the page. Neither code carries a fix, because only the author knows what the sentence was meant to say.

Measured against the eight reference stock templates the finding is exact: 171 true placeholders (lorem ipsum, "Your Subtitle Text Here", "YOUR NAME HERE") and no false positives. Those are demonstration documents whose body copy is filler by design, so the calibration suite records the count per template — copying one and shipping it unedited is precisely what the rule exists to catch, which is a reason to keep it visible rather than to suppress it.

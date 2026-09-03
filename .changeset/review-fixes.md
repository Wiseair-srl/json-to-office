---
'@json-to-office/quality': patch
'@json-to-office/mcp-server': patch
---

Three defects found reviewing this branch.

**An off-palette fix could not repair its own finding.** `palette-adherence` emitted `{ op: 'add' }`, which is the same as `replace` on an object member and very different on an array element: RFC 6902 `add` at `/chartColors/0` _splices_, so applying the fix inserted the theme token and left the off-palette hex behind at index 1. The finding survived the patch that was supposed to remove it. Now `replace`, which is always legal here because the value was read from that exact pointer.

**A truncated PNG decoded to a plausible-looking image.** The contact-sheet decoder's bounds check required both halves of an `&&` that could not be true together, so a short final scanline copied fewer bytes than a row and left the previous row's pixels in the buffer — the bottom of the page silently repeated instead of a refusal.

**Judge evidence went to a directory that does not exist under `--repeat`.** The eval harness's judge derived its output path from the brief id while the runner writes to `runs/<id>#2`, so every verdict after the first pass failed on the write and was swallowed by the runner's catch. The judge is now handed its own run directory. In the same pass: a run that completed but could not be judged no longer counts as a level-1 document in the median, which reported a judge outage as a quality regression.

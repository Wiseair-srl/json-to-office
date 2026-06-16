---
'@json-to-office/jto': patch
---

fix(playground): expand collapsed long-string sentinels before preview/build

The long-string collapser rewrites the Monaco model text, replacing a value's hidden middle with a `§jtoc:<id>§` sentinel that only `toStorageValue()` restores. The save path called it, but the Run/preview path (`preview:flushAndBuild`) read `editor.getValue()` raw at three points, leaking sentinels into the rendered document (and persisting them back into the store).

The per-editor `toStorageValue` reconstructor is now exposed on the editor refs store and applied to every live-text read feeding `saveDocument`, `updateTheme`, and `buildDocument`.

Copy and cut were leaking the sentinel too — the hidden `§jtoc:<id>§` is real model text, so a selection crossing a collapsed chip put the sentinel on the clipboard. `copy`/`cut` are now intercepted in the capture phase and the clipboard is rewritten with the reconstructed value (cut also deletes the selection).

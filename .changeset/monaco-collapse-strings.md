---
'@json-to-office/jto': minor
---

feat(playground): collapse very long JSON strings into clickable chips

Long string values (base64 images, embedded SVGs, big data blobs) wrap into hundreds of rows with wordWrap on, making the editor unusable. The JSON editor now collapses the middle of any value over 200 chars into a hidden sentinel rendered as a clickable chip, keeping a visible head and tail (e.g. `"data:image/png;base64,iVBOR …⟨12.4 KB⟩… AAAA"`). Clicking the chip toggles expand/collapse.

- In-place, same-line collapse keeps every other line number valid (validation markers, folding, minimap unaffected).
- Lossless saves: the full document text is reconstructed before persisting; build/preview/export always see the real value.
- Controlled-value save echoes are ignored so chips and the cursor never thrash while editing.
- Escape-safe head/tail slicing so non-base64 strings never get cut mid-escape.
- Validation markers that fall inside a collapsed chip are filtered out.

---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

The default `docxjs` renderer draws a natively rendered `visual`
(`renderMode: "native"`): the canvas becomes one Word drawing group of real
shapes, text boxes and pictures, as it already did on `office-open`. A native
visual no longer needs `"renderer": "office-open"`, and the schema offers both
visual shapes under either renderer.

It uses `docx/shapes`, which docx 9.8.0 added and the exact pin already
guarantees. The entry is imported only when a document holds a native visual,
so every other document renders exactly as before and loads nothing more.

Where docx.js writes something that cannot be stated through its options, the
package is repaired after packing: group-child ids are deterministic, rotations
are whole units, a group without alt text carries no description, and a text
box keeps Word's text-box flag. A child placed past its canvas grows the
drawing's frame rather than spilling outside it, and a line width or text inset
past Word's 1584pt maximum is clamped rather than refused.

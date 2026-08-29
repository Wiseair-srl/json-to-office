---
'@json-to-office/core-docx': minor
'@json-to-office/quality': minor
---

New `docx/frame-collision` rule (`W_QUALITY_FRAME_COLLISION`): page-anchored
floating frames whose estimated text blocks land on the same page region are
reported as painting over each other — the text-on-text defect the text-fit
rule could not see, since it never compared two frames.

Frame rects come from authored offsets/width plus estimated wrapped height.
Consecutive paragraphs with identical frame properties collapse into one
flowing OOXML frame first (the stock stat-card idiom), overlaps inside one
line height are noise by construction, and slivers of shared width under
240 twips are ignored. Calibrated warning-clean on the stock reference
templates and the all-floating vermilion annual report; frame-text facts gain
resolved anchors, frame-chain identity, and page-flow grouping to carry it.

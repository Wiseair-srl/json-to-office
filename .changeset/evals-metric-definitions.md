---
'@json-to-office/mcp-server': patch
---

Three scorecard numbers did not mean what they said. Caught by the first smoke run that worked, and fixed before a baseline could bake the definitions in.

**"3/3 shippable (100%)"** was a mechanical floor wearing the programme's headline metric's name. It asked only whether the file built, stopped blocking generation and carried no leftover placeholder text — questions with mechanical answers — while the target it appeared to beat by 2x belongs to the judge, which had not looked at anything. It is now `buildsClean`, a test forbids any field in the totals matching `/ship/i`, and a run without a judge prints "no judge: nothing here says whether a document is worth sending".

**"median 18 iterations"** was the SDK's conversational turn count, roughly equal to the tool-call count, reported under a metric whose target is 2. Iterations now counts edit-and-recheck rounds after the first draft — workspace patches, plus re-drafts past the first — so a run that got it right first time scores 0. The turn count survives beside it as `turns`, because it prices the run.

**"6 pages"** was the section count of a six-section report, against a metric that compares pages to a blueprint budget. Pages are now measured by rendering the document at 36 DPI where LibreOffice and poppler are present, and every run records whether its count was `rendered` or `structural`, so a corpus measured across two hosts cannot average the two and report a number belonging to neither.

For the record, that smoke run: 3/3 built clean, no failures, no integrity defects, $2.24 and 11.7 minutes for three briefs. The `W_QUALITY_OFF_PALETTE` and `W_QUALITY_TEXT_TIGHT` findings are Phase 0's own rules firing on real cold-path output, which is the first evidence they work outside a fixture.

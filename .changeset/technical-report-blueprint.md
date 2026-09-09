---
'@json-to-office/core-docx': major
'@json-to-office/shared-docx': major
'@json-to-office/mcp-server': major
'@json-to-office/jto-ops': major
'@json-to-office/jto': major
---

**Breaking (`@json-to-office/core-docx`, `@json-to-office/mcp-server`)**: the DOCX quality profile `technical-report` is now an archetype profile with requirements, and the format default is the new `general` profile. A document that names no profile is judged by `general` and reports `profileId: "general"` where it reported `technical-report`; a document that names `technical-report` now gets the archetype's findings: a running head with page numbers on every section after the cover, a source wherever a block declares one, heading skips as warnings, the three theme-consistency rules with at most nine sizes, rendered empty and under-filled pages as warnings, and at least one chart or table. Nothing blocks by default; the findings advise. Kept as one id rather than a second: a technical-report profile that asked nothing of a technical report was the format default under the wrong name.

The `technical-report` blueprint (#338): a data-heavy report (summary, scope and method, results with a chart and two sub-headed findings and a runs table, recommendations, a readiness statement, references), a narrative one (summary, context, an analysis table, options and risks, a recommendation) and a memo (To, From, Date and Subject in place of a cover, the recommendation first, the options in one table, what would change the answer), all under a running head that numbers the pages and, in the reports, a contents list that LibreOffice renders from cached entries. Its definitions come from a new gallery template, `technical-report-blocks.docx.json`, a load-test report on the house theme that also defines `memo-header`; a test holds a definition shared by name across templates to one shape. `jto_scaffold` fills `memo-header` slots from the brief (`to`, `from`, `date`, and `title` as the subject), maps `###` headings to a section's level-2 heading markers, and writes outline paragraphs only into the body text between one opener and the next, so a memo's single section fills in order.

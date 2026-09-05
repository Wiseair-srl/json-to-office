---
'@json-to-office/jto': patch
---

Fixes the playground's quality-rule table, which had drifted sixteen rules behind the engine, and adds the guard its header had been asking for.

`quality-rules.ts` mirrors the shipped rules so the policy editor can complete and validate them. It listed 6 of 22: everything added since the original five — contrast, box overlap, placeholder text, the SVG and line-box checks, font count, palette adherence, and the new chart and table rules — was absent from both formats.

Its header called that "a wrong hint, never a wrong analysis", and that was true of a wrong entry and wrong about a missing one. `parseQualityPolicy` refuses any rule id the table does not list, so a policy naming one of the sixteen came back `Unknown rule "pptx/box-overlap"` and never reached the server, which would have run it happily. The header now says so.

Every rule is mirrored, in its own pack's order so the two files read side by side, with each rule's real `defaultParameters` — the WCAG ratios behind `pptx/text-contrast`, the overlap floors, the 1.08 width tolerance that is the measured error of the DOCX width model, and the chart and table limits.

A new test compares the table against `DOCX_QUALITY_RULES` and `PPTX_QUALITY_RULES` on ids and order, category and default severity, and parameter names and default values, and checks that a policy naming any shipped rule parses. A parameter of a type the mirror cannot describe fails it too, rather than going quietly undocumented.

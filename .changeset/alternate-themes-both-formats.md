---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
---

`vermilion` and `devportal` in both formats, on the extended theme layers (#330). The two DOCX alternates now carry what `consulting` carried alone: `palette` roles with an ordered chart series, every type role and a per-canvas scale, a spacing base and safe area, the chrome recipes the report blocks paint from, and a motif — so a client or technical report scaffolded on either theme gets its own eyebrows, key-takeaways rule, cover rule and running head rather than the house defaults. Each gains a PPTX twin, `vermilion.pptx.theme.json` and `devportal.pptx.theme.json`, sharing its palette, chart series, chrome recipes, motif and font families with the report theme; the twin agreement test that held `consulting` to its report now holds all three pairs, and the consulting deck template renders warning-clean on every registered theme. Every family the four themes name is in SAFE_FONTS, so none needs a font registry, and the block matrix renders the report blocks on all of them with the design faces and with the DejaVu fallback. The themes guide shows both alternates in both formats beside the house theme.

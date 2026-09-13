---
'@json-to-office/core-pptx': patch
'@json-to-office/core-docx': patch
---

The brand rules no longer lint a theme's own definition as authored content. A deck carrying its theme by value in `props.theme` came back with `W_QUALITY_OFF_PALETTE` on the theme's own values (the consulting theme's chart gridline, `#E4E7EB`), where the same theme named validated clean; a DOCX report's `props.themeOverrides` had the same defect, and `W_QUALITY_FONT_COUNT` counted `mono` and `light` families from its overrides that nothing paints. The document's own colours are still judged against the palette the inline or overridden theme defines.

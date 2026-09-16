---
'@json-to-office/shared-docx': major
'@json-to-office/shared-pptx': major
'@json-to-office/core-docx': major
'@json-to-office/core-pptx': major
'@json-to-office/json-to-docx': major
'@json-to-office/json-to-pptx': major
'@json-to-office/jto-ops': major
'@json-to-office/jto-cli': major
'@json-to-office/jto': major
'@json-to-office/mcp-server': major
---

`consulting` is the default theme in both formats (#331).

Breaking changes:

- A DOCX document that names no theme, or a theme that does not exist, renders on `consulting` instead of `minimal`. Name `"theme": "minimal"` to keep the old look.
- A PPTX deck that names no theme, or a theme that does not exist, renders on `consulting` instead of the Office-style `default` theme.
- The PPTX `default` theme is removed. `"theme": "default"` is now an unknown name: validation reports `W_UNKNOWN_THEME` and generation falls back to `consulting`. `dark` and `minimal` remain as explicit alternates; a deck that needs the old blue, orange and green look supplies it as a custom or inline theme.
- `DEFAULT_PPTX_THEME` is the consulting theme, and `getPptxTheme` falls back to it. Both schemas default `theme` to `"consulting"`, and `BUILT_IN_PPTX_THEME_NAMES` no longer lists `default`.
- A rasterized DOCX `visual` whose canvas names no theme renders on the consulting PPTX theme, so canvas text without a `fontFace` sets in Calibri rather than Arial. Name `canvas.theme` to choose. Native visuals resolve against the document's DOCX theme and do not change.
- The playground, `jto init`, the CLI plugin config and the dry-run `Theme:` line use `consulting` where they used `minimal` or `default`; the MCP server's catalog no longer lists `default`, and its instructions say what a theme-less document gets.

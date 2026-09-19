---
'@json-to-office/core-pptx': patch
'@json-to-office/mcp-server': patch
---

Radial gradient fills and slide backgrounds now look the same in PowerPoint as in LibreOffice and the preview: they ship as a picture of the gradient instead of a DrawingML path gradient, which PowerPoint stretched into a slide-wide ellipse. A center-focus radial gradient (the default) is now also sampled about the middle by the text-contrast check.

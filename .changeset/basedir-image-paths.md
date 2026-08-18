---
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/shared': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

Relative image/media paths now resolve against the document's own directory instead of `process.cwd()` (#142). New `baseDir` option on core generation (`generateBufferFromJson` et al.), plugin builders (constructor + per-call), CLI `generate` (auto-set to the input file's directory), the playground server (via `options.sourceName` mapped through discovery), and the pptx rasterizer request (docx `visual` components forward it). cwd stays the fallback when no baseDir is provided. Stock template media paths shrunk to document-relative `media/...`; stale `templates` entry dropped from `packages/jto` package `files`.

/**
 * Node-only font helpers.
 *
 * Imports Node built-ins (fs, path, crypto) so must NOT be pulled into
 * browser bundles. Keep this subpath separate from the main package index.
 */

export { loadFileFontSource } from './sources/file-loader';
export { FontDiskCache } from './cache/disk-cache';
// subset-font reaches for `fs.promises.readFile` at init to load its
// harfbuzz-wasm blob. Harmless on Node, fatal in the browser. Routing the
// variable-font fetcher through this Node-only subpath keeps it out of
// client bundles — the registry only invokes it when the caller injects
// it (the core-docx/core-pptx server-side pipelines do).
export { fetchVariableFontSource } from './sources/variable-fetcher';
export type { VariableFetchOptions } from './sources/variable-fetcher';

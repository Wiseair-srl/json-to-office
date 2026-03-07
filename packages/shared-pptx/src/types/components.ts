/**
 * Component Types for Plugin System
 */
import type { PptxJsonComponentDefinition } from '../schemas/document';

/**
 * ReportComponent alias — in docx this was a specific discriminated union member;
 * in pptx the top-level container is `PptxJsonComponentDefinition`.
 * Kept as an alias for CLI code compatibility.
 */
export type ReportComponent = PptxJsonComponentDefinition;

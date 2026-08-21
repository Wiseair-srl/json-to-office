/**
 * Heading Component
 * Standard component for rendering heading elements in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isHeadingComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createHeading } from '../core/content';
import { globalBookmarkRegistry } from '../utils/bookmarkRegistry';
import {
  globalNumberingRegistry,
  createHeadingNumberingConfig,
  HEADING_NUMBERING_REFERENCE,
} from '../utils/numberingConfig';

/** Word supports six heading levels; deeper input renders as Heading1. */
const MAX_HEADING_LEVEL = 6;

/**
 * Paragraph-level numbering for this heading, or undefined to leave `w:numPr`
 * off entirely.
 *
 * The shared definition is registered lazily, on the first numbered heading,
 * so a document without one carries no extra `w:abstractNum`.
 */
function headingNumbering(
  numbering: boolean | undefined,
  level: number
): { reference: string; level: number } | false | undefined {
  // An explicit false is the per-heading opt-out from a numbering that
  // componentDefaults turned on document-wide; docx writes it as numId 0.
  if (numbering === false) return false;
  if (numbering !== true) return undefined;

  if (!globalNumberingRegistry.has(HEADING_NUMBERING_REFERENCE)) {
    globalNumberingRegistry.register(createHeadingNumberingConfig());
  }

  // Mirrors getStyleIdForLevel: an out-of-range level renders as Heading1, so
  // it must number as level 1 too.
  const styleLevel = level >= 1 && level <= MAX_HEADING_LEVEL ? level : 1;
  return { reference: HEADING_NUMBERING_REFERENCE, level: styleLevel - 1 };
}

/**
 * Render heading component
 */
export function renderHeadingComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Paragraph[] {
  if (!isHeadingComponent(component)) return [];

  // Props are pre-resolved by resolveComponentTree (componentDefaults + level-specific defaults)
  const config = component.props;

  // Generate or use bookmark ID for internal linking
  // If component has id, use it; otherwise generate from heading text
  const bookmarkId =
    (component as any).id ||
    globalBookmarkRegistry.generateId(config.text, 'heading');

  // Create heading with optional column break and bookmark
  const header = createHeading(
    config.text,
    config.level || 1,
    theme,
    themeName,
    {
      alignment: config.alignment,
      spacing: config.spacing,
      lineSpacing: config.lineSpacing,
      columnBreak: config.columnBreak,
      // Local font overrides
      fontFamily: config.font?.family,
      fontSize: config.font?.size,
      fontColor: config.font?.color,
      bold: config.font?.bold,
      fontWeight: (config.font as { fontWeight?: number } | undefined)
        ?.fontWeight,
      italic: config.font?.italic,
      underline: config.font?.underline,
      scale: config.font?.scale,
      characterSpacing: config.font?.characterSpacing,
      // Proofing: local language override + no-proof toggle + known-words list
      language: config.language,
      noProof: config.noProof,
      noProofWords: config.noProofWords,
      // Pagination control
      keepNext: config.keepNext,
      keepLines: config.keepLines,
      // Paragraph indentation (w:ind) in twips
      indent: config.indent,
      // Bookmark ID for internal linking
      bookmarkId: bookmarkId,
      // Auto-numbering (1., 1.1., …) through the shared heading definition
      numbering: headingNumbering(config.numbering, config.level || 1),
      // Tracked-change segments (rendered as native Word revisions)
      revision: config.revision,
      // Review comment anchored to this heading's text
      comment: config.comment,
    }
  );

  return [header];
}

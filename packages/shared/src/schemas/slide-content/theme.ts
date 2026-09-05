/**
 * Theme primitives shared by PPTX slide content embedded across formats.
 */

import { Type } from '@sinclair/typebox';
import { TYPE_ROLES } from '../../theme/design-system';

const HexColorSchema = Type.String({
  pattern: '^#?[0-9A-Fa-f]{6}$',
  description: 'Hex color (e.g. #FF0000)',
});

export const SEMANTIC_COLOR_NAMES = [
  'primary',
  'secondary',
  'accent',
  'background',
  'text',
  'text2',
  'background2',
  'accent4',
  'accent5',
  'accent6',
] as const;

/** PowerPoint XML aliases that resolve to canonical semantic names at runtime */
export const SEMANTIC_COLOR_ALIASES = [
  'accent1',
  'accent2',
  'accent3',
  'tx1',
  'tx2',
  'bg1',
  'bg2',
] as const;

export const ColorValueSchema = Type.Union(
  [
    HexColorSchema,
    ...SEMANTIC_COLOR_NAMES.map((name) => Type.Literal(name)),
    ...SEMANTIC_COLOR_ALIASES.map((name) => Type.Literal(name)),
  ],
  { description: 'Hex color or semantic theme color name' }
);

export const STYLE_NAMES = [
  'title',
  'subtitle',
  'heading1',
  'heading2',
  'heading3',
  'body',
  'caption',
  ...TYPE_ROLES,
] as const;

export const StyleNameSchema = Type.Union(
  STYLE_NAMES.map((name) => Type.Literal(name)),
  { description: 'Predefined style name' }
);

export type StyleName = (typeof STYLE_NAMES)[number];

/**
 * Alignment Utilities
 * Shared utilities for converting alignment strings to docx AlignmentType
 */

import { AlignmentType } from 'docx';

/**
 * Convert alignment string to docx AlignmentType
 */
export function getAlignment(
  alignment: string
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (alignment) {
  case 'center':
    return AlignmentType.CENTER;
  case 'right':
    return AlignmentType.RIGHT;
  case 'justify':
    return AlignmentType.JUSTIFIED;
  default:
    return AlignmentType.LEFT;
  }
}

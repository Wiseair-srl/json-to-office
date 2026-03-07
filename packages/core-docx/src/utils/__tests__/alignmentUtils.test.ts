import { describe, it, expect } from 'vitest';
import { getAlignment } from '../alignmentUtils';
import { AlignmentType } from 'docx';

describe('alignmentUtils', () => {
  describe('getAlignment', () => {
    it('should return CENTER for "center" alignment', () => {
      const result = getAlignment('center');
      expect(result).toBe(AlignmentType.CENTER);
    });

    it('should return RIGHT for "right" alignment', () => {
      const result = getAlignment('right');
      expect(result).toBe(AlignmentType.RIGHT);
    });

    it('should return JUSTIFIED for "justify" alignment', () => {
      const result = getAlignment('justify');
      expect(result).toBe(AlignmentType.JUSTIFIED);
    });

    it('should return LEFT for "left" alignment', () => {
      const result = getAlignment('left');
      expect(result).toBe(AlignmentType.LEFT);
    });

    it('should return LEFT as default for unknown alignment', () => {
      const result = getAlignment('unknown');
      expect(result).toBe(AlignmentType.LEFT);
    });

    it('should return LEFT as default for empty string', () => {
      const result = getAlignment('');
      expect(result).toBe(AlignmentType.LEFT);
    });

    it('should handle case variations (return LEFT as default)', () => {
      // Since the function is case-sensitive, these should all return LEFT
      expect(getAlignment('Center')).toBe(AlignmentType.LEFT);
      expect(getAlignment('RIGHT')).toBe(AlignmentType.LEFT);
      expect(getAlignment('Justify')).toBe(AlignmentType.LEFT);
      expect(getAlignment('LEFT')).toBe(AlignmentType.LEFT);
    });

    it('should handle whitespace (return LEFT as default)', () => {
      expect(getAlignment(' center ')).toBe(AlignmentType.LEFT);
      expect(getAlignment('center ')).toBe(AlignmentType.LEFT);
      expect(getAlignment(' center')).toBe(AlignmentType.LEFT);
    });

    it('should handle special characters (return LEFT as default)', () => {
      expect(getAlignment('center!')).toBe(AlignmentType.LEFT);
      expect(getAlignment('center-align')).toBe(AlignmentType.LEFT);
      expect(getAlignment('center_align')).toBe(AlignmentType.LEFT);
    });
  });
});

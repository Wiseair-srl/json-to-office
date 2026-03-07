import { describe, it, expect } from 'vitest';
import { formatDate } from '../formatters';

describe('formatters', () => {
  describe('formatDate', () => {
    it('should format date with default format', () => {
      const date = new Date('2024-01-15T00:00:00');
      const result = formatDate(date);
      expect(result).toBe('January 15, 2024');
    });

    it('should format date with custom format string', () => {
      const date = new Date('2024-01-15T00:00:00');
      const result = formatDate(date, 'MM/dd/yyyy');
      expect(result).toBe('01/15/2024');
    });

    it('should format date with different format patterns', () => {
      const date = new Date('2024-01-15T14:30:00');

      expect(formatDate(date, 'yyyy-MM-dd')).toBe('2024-01-15');
      expect(formatDate(date, 'dd/MM/yyyy')).toBe('15/01/2024');
      expect(formatDate(date, 'MMM d, yyyy')).toBe('Jan 15, 2024');
      expect(formatDate(date, 'EEEE, MMMM do, yyyy')).toMatch(
        /Monday, January 15th, 2024/
      );
    });

    it('should handle time formatting', () => {
      const date = new Date('2024-01-15T14:30:45');

      expect(formatDate(date, 'HH:mm:ss')).toBe('14:30:45');
      expect(formatDate(date, 'h:mm a')).toBe('2:30 PM');
    });

    it('should handle different months', () => {
      expect(formatDate(new Date('2024-03-01'), 'MMMM')).toBe('March');
      expect(formatDate(new Date('2024-07-01'), 'MMMM')).toBe('July');
      expect(formatDate(new Date('2024-12-01'), 'MMMM')).toBe('December');
    });

    it('should handle leap year dates', () => {
      const leapDate = new Date('2024-02-29');
      expect(formatDate(leapDate, 'MMMM d, yyyy')).toBe('February 29, 2024');
    });

    it('should handle edge cases', () => {
      // First day of year
      expect(formatDate(new Date('2024-01-01'), 'MMMM d, yyyy')).toBe(
        'January 1, 2024'
      );

      // Last day of year
      expect(formatDate(new Date('2024-12-31'), 'MMMM d, yyyy')).toBe(
        'December 31, 2024'
      );
    });
  });
});

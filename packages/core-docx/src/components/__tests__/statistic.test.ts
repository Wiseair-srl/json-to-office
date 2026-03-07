import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Paragraph } from 'docx';
import { createMockTheme } from './helpers';
import type { ComponentDefinition } from '../../types';

// Mock createStatistic function
vi.mock('../../core/content', async () => {
  const { Paragraph } = await vi.importActual<typeof import('docx')>('docx');
  return {
    createStatistic: vi.fn().mockReturnValue([new Paragraph({})]),
  };
});

import { renderStatisticComponent } from '../statistic';

describe('components/statistic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('renderStatisticComponent', () => {
    it('should render simple statistic with number and description', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '42',
          description: 'Total Items',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render statistic with numeric value', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '100',
          description: 'Percentage Complete',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render statistic with formatting', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '$1,234.56',
          description: 'Total Revenue',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with left alignment', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '10',
          description: 'Left Aligned',
          alignment: 'left',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with center alignment', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '50%',
          description: 'Center Aligned',
          alignment: 'center',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with right alignment', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '999',
          description: 'Right Aligned',
          alignment: 'right',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with right alignment', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '75',
          description: 'Right Aligned',
          alignment: 'right',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with custom spacing', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '25',
          description: 'With Spacing',
          spacing: {
            before: 240,
            after: 480,
          },
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with only before spacing', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '33',
          description: 'Before Spacing Only',
          spacing: {
            before: 360,
          },
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with only after spacing', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '67',
          description: 'After Spacing Only',
          spacing: {
            after: 300,
          },
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with short description', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '123',
          description: 'Count',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle statistic with empty description', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '456',
          description: '',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle very large numbers', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '999,999,999,999',
          description: 'Large Number',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle decimal numbers', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '3.14159',
          description: 'Pi Value',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle percentage values', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '87.5%',
          description: 'Success Rate',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply theme styles', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '100',
          description: 'Themed Statistic',
        },
      };

      const theme = createMockTheme({
        componentDefaults: {
          statistic: {
            spacing: {
              before: 180,
              after: 180,
            },
          },
        },
      });

      const result = renderStatisticComponent(component, theme);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle non-statistic component type', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          content: 'Not a statistic',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('should handle missing config', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
      } as ComponentDefinition;

      const result = renderStatisticComponent(component, createMockTheme());

      // Should handle gracefully
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle special characters in description', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '42',
          description: 'Special chars: & < > " \' © ® ™',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle multiline description', () => {
      const component: ComponentDefinition = {
        name: 'statistic',
        props: {
          number: '500',
          description: 'Line 1\nLine 2\nLine 3',
        },
      };

      const result = renderStatisticComponent(component, createMockTheme());

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });
  });
});

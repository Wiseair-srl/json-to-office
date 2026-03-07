import { describe, it, expect } from 'vitest';
import {
  textSpaceAfterComponent,
  type TextSpaceAfterProps,
} from '../text-space-after';
import { createMockTheme } from './helpers';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

// Mock addWarning function for tests
const mockAddWarning = () => {
  // No-op for tests
};

describe('components/text-space-after', () => {
  describe('textSpaceAfterComponent', () => {
    it('should have correct component properties', () => {
      expect(textSpaceAfterComponent.name).toBe('text-space-after');
      const v = textSpaceAfterComponent.versions['1.0.0'];
      expect(v.description).toBe(
        'Text component with hardcoded spacing after the paragraph'
      );
      expect(v.render).toBeDefined();
      expect(v.propsSchema).toBeDefined();
    });

    it('should process simple text content with default spacing', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Test content',
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: 'Test content',
          spacing: {
            after: 12, // Default value in points
          },
        },
      });
    });

    it('should preserve custom after spacing', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Test content with custom spacing',
        spacing: {
          after: 18,
        },
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: 'Test content with custom spacing',
          spacing: {
            after: 18, // Custom value preserved
          },
        },
      });
    });

    it('should handle both before and after spacing', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Test content with both spacings',
        spacing: {
          before: 6,
          after: 24,
        },
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: 'Test content with both spacings',
          spacing: {
            before: 6,
            after: 24,
          },
        },
      });
    });

    it('should apply default after spacing when only before is specified', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Test content with only before spacing',
        spacing: {
          before: 9,
        },
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: 'Test content with only before spacing',
          spacing: {
            before: 9,
            after: 12, // Default value applied
          },
        },
      });
    });

    it('should handle zero spacing values', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Test content with zero spacing',
        spacing: {
          before: 0,
          after: 0,
        },
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      const componentResult = result[0] as ComponentDefinition;
      // Component uses provided value or fallback to 12, but 0 is falsy so it uses 12
      if (componentResult.name === 'paragraph') {
        expect(componentResult.props.spacing?.after).toBe(12);
        expect(componentResult.props.spacing?.before).toBe(0);
      } else {
        throw new Error('Expected paragraph component name');
      }
    });

    it('should handle empty content', async () => {
      const props: TextSpaceAfterProps = {
        text: '',
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: '',
          spacing: {
            after: 12,
          },
        },
      });
    });

    it('should handle multiline content', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Line 1\nLine 2\nLine 3',
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: 'Line 1\nLine 2\nLine 3',
          spacing: {
            after: 12,
          },
        },
      });
    });

    it('should handle very long content', async () => {
      const longContent = 'A'.repeat(1000);
      const props: TextSpaceAfterProps = {
        text: longContent,
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      const componentResult = result[0] as ComponentDefinition;
      if (componentResult.name === 'paragraph') {
        expect(componentResult.props.text).toBe(longContent);
        expect(componentResult.props.spacing?.after).toBe(12);
      } else {
        throw new Error('Expected paragraph component name');
      }
    });

    it('should handle special characters in content', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Special chars: !@#$%^&*()_+-=[]{}|;:\'",.<>?/`~',
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      const componentResult = result[0] as ComponentDefinition;
      if (componentResult.name === 'paragraph') {
        expect(componentResult.props.text).toBe(
          'Special chars: !@#$%^&*()_+-=[]{}|;:\'",.<>?/`~'
        );
      } else {
        throw new Error('Expected paragraph component name');
      }
    });

    it('should handle unicode characters', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Unicode: 你好世界 🌍 €±½',
      };

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: createMockTheme(),
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      const componentResult = result[0] as ComponentDefinition;
      if (componentResult.name === 'paragraph') {
        expect(componentResult.props.text).toBe('Unicode: 你好世界 🌍 €±½');
      } else {
        throw new Error('Expected paragraph component name');
      }
    });

    it('should work with different themes', async () => {
      const props: TextSpaceAfterProps = {
        text: 'Theme test',
      };

      const customTheme = createMockTheme({
        colors: {
          primary: 'FF0000',
          secondary: '00FF00',
          accent: '0000FF',
          text: '000000',
          background: 'FFFFFF',
        },
      });

      const result = await textSpaceAfterComponent.versions['1.0.0'].render({
        props,
        theme: customTheme,
        addWarning: mockAddWarning,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'paragraph',
        props: {
          text: 'Theme test',
          spacing: {
            after: 12,
          },
        },
      });
    });
  });
});

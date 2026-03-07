import { describe, it, expect } from 'vitest';
import { renderParagraphComponent } from '../paragraph';
import { Paragraph } from 'docx';
import type { ComponentDefinition } from '../../types';
import type { ThemeConfig } from '../../styles';
import { createMockTheme } from './helpers';

describe('components/text', () => {
  describe('renderParagraphComponent', () => {
    it('should render simple text', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Simple text content',
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render text without paragraph props', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Centered text',
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply text styles', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Styled text',
          font: {
            family: 'Arial',
            bold: true,
            italic: true,
            underline: true,
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle text with color', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Colored text',
          font: { family: 'Arial', color: '#FF0000' },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle text with font size', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Large text',
          font: { family: 'Arial', size: 24 },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle text with font family', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Custom font text',
          font: { family: 'Arial' },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply theme styles', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Themed text',
        },
      };

      const theme = {
        text: {
          fontSize: 14,
          color: '#333333',
          fontFamily: 'Calibri',
        },
      };

      const result = renderParagraphComponent(
        component,
        theme as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle empty text', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: '',
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle multiline text', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Line 1\nLine 2\nLine 3',
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply spacing', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Text with spacing',
          spacing: {
            before: 120,
            after: 240,
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render inline text by default', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Inline text',
          // positioning deprecated; inline by default
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render floating text with basic positioning', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Floating text',
          // positioning deprecated; presence of floating makes it floating
          floating: {
            horizontalPosition: {
              relative: 'margin',
              align: 'right',
            },
            verticalPosition: {
              relative: 'page',
              align: 'top',
            },
            wrap: {
              type: 'around',
            },
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render floating text with offset positioning', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Floating text with offset',
          // positioning deprecated; presence of floating makes it floating
          floating: {
            horizontalPosition: {
              relative: 'page',
              offset: 1440, // 1 inch in twips
            },
            verticalPosition: {
              relative: 'page',
              offset: 720, // 0.5 inch in twips
            },
            wrap: {
              type: 'none',
            },
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render floating text with dimensions', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Floating text with size',
          // positioning deprecated; presence of floating makes it floating
          floating: {
            horizontalPosition: {
              relative: 'margin',
              align: 'center',
            },
            verticalPosition: {
              relative: 'page',
              align: 'center',
            },
            wrap: {
              type: 'tight',
            },
            width: 2880, // 2 inches in twips
            height: 1440, // 1 inch in twips
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render floating text with anchor lock', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Floating text with locked anchor',
          // positioning deprecated; presence of floating makes it floating
          floating: {
            horizontalPosition: {
              relative: 'paragraph',
              align: 'left',
            },
            verticalPosition: {
              relative: 'paragraph',
              align: 'top',
            },
            wrap: {
              type: 'around',
            },
            lockAnchor: true,
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render floating text with all wrapping types', () => {
      const wrapTypes: Array<
        'around' | 'none' | 'notBeside' | 'through' | 'tight' | 'auto'
      > = ['around', 'none', 'notBeside', 'through', 'tight', 'auto'];

      wrapTypes.forEach((wrapType) => {
        const component: ComponentDefinition = {
          name: 'paragraph',
          props: {
            text: `Floating text with ${wrapType} wrap`,
            // positioning deprecated; presence of floating makes it floating
            floating: {
              horizontalPosition: {
                relative: 'margin',
                align: 'left',
              },
              verticalPosition: {
                relative: 'page',
                align: 'top',
              },
              wrap: {
                type: wrapType,
              },
            },
          },
        };

        const result = renderParagraphComponent(
          component,
          createMockTheme(),
          'minimal'
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Paragraph);
      });
    });

    it('should handle floating text without wrap config', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          text: 'Floating text without wrap',
          // positioning deprecated; presence of floating makes it floating
          floating: {
            horizontalPosition: {
              relative: 'page',
              align: 'center',
            },
            verticalPosition: {
              relative: 'page',
              align: 'center',
            },
          },
        },
      };

      const result = renderParagraphComponent(
        component,
        createMockTheme(),
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });
  });
});

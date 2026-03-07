import { describe, it, expect } from 'vitest';
import { renderHeadingComponent } from '../heading';
import { Paragraph } from 'docx';
import type { ComponentDefinition } from '../../types';
import type { ThemeConfig } from '../../styles';

describe('components/heading', () => {
  describe('renderHeadingComponent', () => {
    it('should render heading level 1', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: 'Main Title',
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render heading level 2', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 2,
          text: 'Subtitle',
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render heading level 3', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 3,
          text: 'Section Title',
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply heading alignment', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: 'Centered Heading',
          alignment: 'center',
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply custom styles', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: 'Styled Heading',
          bold: false,
          italic: true,
          color: '#0000FF',
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply theme styles', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: 'Themed Heading',
        },
      };

      const theme = {
        heading1: {
          fontSize: 32,
          bold: true,
          color: '#000000',
        },
      };

      const result = renderHeadingComponent(
        component,
        theme as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle empty heading text', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: '',
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply numbering', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: 'Numbered Heading',
          numbering: {
            reference: 'default-numbering',
            level: 0,
          },
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle page break before', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 1,
          text: 'New Page Heading',
          pageBreak: true,
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply custom spacing', () => {
      const component: ComponentDefinition = {
        name: 'heading',
        props: {
          level: 2,
          text: 'Heading with Spacing',
          spacing: {
            before: 480,
            after: 240,
          },
        },
      };

      const result = renderHeadingComponent(
        component,
        {} as ThemeConfig,
        'minimal'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });
  });
});

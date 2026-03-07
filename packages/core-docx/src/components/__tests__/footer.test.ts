import { describe, it, expect } from 'vitest';
import { renderFooterComponent } from '../footer';
import { Paragraph } from 'docx';
import { createMockTheme, TEST_THEME_NAME } from './helpers';
import type { ComponentDefinition } from '../../types';
import type { ThemeConfig } from '../../styles';

describe('components/footer', () => {
  describe('renderFooterComponent', () => {
    it('should render footer with default center alignment', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {},
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render footer with left alignment', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {
          alignment: 'left',
        },
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render footer with right alignment', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {
          alignment: 'right',
        },
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render footer with center alignment', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {
          alignment: 'center',
        },
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render footer with right alignment', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {
          alignment: 'right',
        },
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply theme styles', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {},
      };

      const theme = createMockTheme({
        colors: {
          primary: 'FF0000',
          secondary: '00FF00',
          accent: '0000FF',
          text: '111111',
          background: 'EEEEEE',
        },
        fonts: {
          body: 'Times New Roman',
          heading: 'Georgia',
          mono: 'Consolas',
        },
      });

      const result = renderFooterComponent(component, theme, TEST_THEME_NAME);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle non-footer component type', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          content: 'Not a footer',
        },
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('should handle missing config', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {},
      };

      const result = renderFooterComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle empty theme', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {
          alignment: 'center',
        },
      };

      const result = renderFooterComponent(
        component,
        {} as ThemeConfig,
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle different theme names', () => {
      const component: ComponentDefinition = {
        name: 'footer',
        props: {},
      };

      const themeNames = ['minimal', 'classic', 'professional', 'custom'];

      themeNames.forEach((themeName) => {
        const result = renderFooterComponent(
          component,
          createMockTheme(),
          themeName
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Paragraph);
      });
    });
  });
});

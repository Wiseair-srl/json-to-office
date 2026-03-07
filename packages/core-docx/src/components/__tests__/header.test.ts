import { describe, it, expect } from 'vitest';
import { renderHeaderComponent } from '../header';
import { Paragraph } from 'docx';
import { createMockTheme, TEST_THEME_NAME } from './helpers';
import type { ComponentDefinition } from '../../types';
import type { ThemeConfig } from '../../styles';

describe('components/header', () => {
  describe('renderHeaderComponent', () => {
    it('should render header with default center alignment', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {},
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render header with left alignment', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {
          alignment: 'left',
        },
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render header with right alignment', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {
          alignment: 'right',
        },
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render header with center alignment', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {
          alignment: 'center',
        },
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply theme styles', () => {
      const component: ComponentDefinition = {
        name: 'header',
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

      const result = renderHeaderComponent(component, theme, TEST_THEME_NAME);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle non-header component type', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          content: 'Not a header',
        },
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('should handle missing config', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {},
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle empty theme', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {
          alignment: 'center',
        },
      };

      const result = renderHeaderComponent(
        component,
        {} as ThemeConfig,
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle different theme names', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {},
      };

      const themeNames = ['minimal', 'classic', 'professional', 'custom'];

      themeNames.forEach((themeName) => {
        const result = renderHeaderComponent(
          component,
          createMockTheme(),
          themeName
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Paragraph);
      });
    });

    it('should handle custom text content', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {
          text: 'Custom Header Text',
          alignment: 'left',
        },
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle page numbers configuration', () => {
      const component: ComponentDefinition = {
        name: 'header',
        props: {
          showPageNumbers: true,
          alignment: 'right',
        },
      };

      const result = renderHeaderComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });
  });
});

/**
 * Structure PageBreak Tests
 * Tests for section pageBreak processing at structure level
 */

import { describe, it, expect } from 'vitest';
import { extractSections, processDocument } from '../structure';
import {
  ComponentDefinition,
  RenderContext,
  ReportComponentDefinition,
} from '../../types';
import { createMockTheme } from '../../components/__tests__/helpers';
import { ThemeConfig } from '../../styles';

describe('Structure PageBreak', () => {
  const context: RenderContext = {
    fullTheme: createMockTheme(),
  };

  describe('Titleless sections', () => {
    it('should preserve pageBreak flag for titleless sections', async () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            pageBreak: true,
            // No title
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Content' },
            },
          ],
        },
      ];

      const sections = await extractSections(components, context);

      expect(sections).toHaveLength(1);
      expect(sections[0].pageBreak).toBe(true);
      // Should NOT insert any invisible heading
      expect(sections[0].components).toHaveLength(1);
      expect(sections[0].components[0].name).toBe('paragraph');
    });

    it('should preserve pageBreak: false for titleless sections', async () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            pageBreak: false,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Content' },
            },
          ],
        },
      ];

      const sections = await extractSections(components, context);

      expect(sections).toHaveLength(1);
      expect(sections[0].pageBreak).toBe(false);
      expect(sections[0].components).toHaveLength(1);
    });

    it('should default pageBreak to true for titleless sections', async () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            // No pageBreak specified, no title
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Content' },
            },
          ],
        },
      ];

      const sections = await extractSections(components, context);

      expect(sections).toHaveLength(1);
      // Should default to true
      expect(sections[0].pageBreak).toBe(true);
    });
  });

  describe('Sections with titles', () => {
    it('should not set pageBreak flag when section has title', async () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            title: 'Section Title',
            level: 1,
            pageBreak: true,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Content' },
            },
          ],
        },
      ];

      const sections = await extractSections(components, context);

      expect(sections).toHaveLength(1);
      // pageBreak flag should NOT be set (handled by heading instead)
      expect(sections[0].pageBreak).toBeUndefined();
      // Heading should be inserted with pageBreak
      expect(sections[0].components[0].name).toBe('heading');
      expect(sections[0].components[0].props.pageBreak).toBe(true);
    });

    it('should insert heading with pageBreak: false when specified', async () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            title: 'Section Title',
            level: 1,
            pageBreak: false,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Content' },
            },
          ],
        },
      ];

      const sections = await extractSections(components, context);

      expect(sections).toHaveLength(1);
      expect(sections[0].pageBreak).toBeUndefined();
      expect(sections[0].components[0].name).toBe('heading');
      expect(sections[0].components[0].props.pageBreak).toBe(false);
    });
  });

  describe('Theme componentDefaults', () => {
    // resolveComponentDefaults used to bail out on a missing `props` key, so a
    // propless section never saw componentDefaults.section and defaulted to a
    // page break.
    const themeWithoutPageBreak: ThemeConfig = {
      ...createMockTheme(),
      componentDefaults: { section: { pageBreak: false } },
    };

    const documentWith = (
      section: ComponentDefinition
    ): ReportComponentDefinition => ({
      name: 'docx',
      props: {},
      children: [section],
    });

    const proplessSection = () =>
      documentWith({
        name: 'section',
        children: [{ name: 'paragraph', props: { text: 'Content' } }],
      } as ComponentDefinition);

    // The regression case: only an absent `props` key hit the old early return.
    it('should apply section pageBreak default to a section with no props key', async () => {
      const processed = await processDocument(
        proplessSection(),
        themeWithoutPageBreak,
        'mock'
      );

      expect(processed.sections).toHaveLength(1);
      // No page break: the theme default reached the propless section.
      expect(processed.sections[0].pageBreak).toBe(false);

      // Same input, theme without componentDefaults.section — a titleless
      // section falls back to true, so the false above is the theme's doing.
      const withoutDefaults = await processDocument(
        proplessSection(),
        createMockTheme(),
        'mock'
      );
      expect(withoutDefaults.sections[0].pageBreak).toBe(true);
    });

    // Control, not proof: `{}` is truthy, so it always took the resolver path.
    // Kept to guard the empty-props path from regressing alongside the fix.
    it('control: empty props already picked up the pageBreak default', async () => {
      const processed = await processDocument(
        documentWith({
          name: 'section',
          props: {},
          children: [{ name: 'paragraph', props: { text: 'Content' } }],
        }),
        themeWithoutPageBreak,
        'mock'
      );

      expect(processed.sections[0].pageBreak).toBe(false);
    });

    it('should let an explicit pageBreak win over the theme default', async () => {
      const processed = await processDocument(
        documentWith({
          name: 'section',
          props: { pageBreak: true },
          children: [{ name: 'paragraph', props: { text: 'Content' } }],
        }),
        themeWithoutPageBreak,
        'mock'
      );

      expect(processed.sections[0].pageBreak).toBe(true);
    });
  });

  describe('TOC section scenario', () => {
    it('should handle TOC-only titleless section with pageBreak', async () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            pageBreak: true,
          },
          children: [
            {
              name: 'toc',
              props: {
                title: 'Table of Contents',
              },
            },
          ],
        },
      ];

      const sections = await extractSections(components, context);

      expect(sections).toHaveLength(1);
      expect(sections[0].pageBreak).toBe(true);
      // TOC should be the only component (no invisible heading inserted)
      expect(sections[0].components).toHaveLength(1);
      expect(sections[0].components[0].name).toBe('toc');
    });
  });
});

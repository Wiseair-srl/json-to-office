/**
 * Structure PageBreak Tests
 * Tests for section pageBreak processing at structure level
 */

import { describe, it, expect } from 'vitest';
import { extractSections } from '../structure';
import { ComponentDefinition, RenderContext } from '../../types';

describe('Structure PageBreak', () => {
  const context: RenderContext = {};

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

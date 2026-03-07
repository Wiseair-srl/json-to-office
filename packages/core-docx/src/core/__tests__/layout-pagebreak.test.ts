/**
 * Layout PageBreak Tests
 * Tests for section and heading pageBreak behavior
 */

import { describe, it, expect } from 'vitest';
import { analyzeLayoutGroups } from '../layout';
import { ComponentDefinition } from '../../types';

describe('Layout PageBreak', () => {
  describe('Section pageBreak', () => {
    it('should create page break before section by default', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'section',
          props: {
            title: 'Section 1',
            level: 1,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Section content' },
            },
          ],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      // Should have 2 groups: intro + section
      expect(groups).toHaveLength(2);
      // First group (intro) should not have break
      expect(groups[0].breakBefore).toBe(false);
      // Second group (section) should have break
      expect(groups[1].breakBefore).toBe(true);
    });

    it('should not create page break when pageBreak: false', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'section',
          props: {
            title: 'Section 1',
            level: 1,
            pageBreak: false,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Section content' },
            },
          ],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      // Should have 1 group: intro + section together (no break)
      expect(groups).toHaveLength(1);
      expect(groups[0].breakBefore).toBe(false);
      // Both components should be in the same group
      expect(groups[0].components.length).toBeGreaterThan(1);
    });

    it('should create page break when pageBreak: true', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'section',
          props: {
            title: 'Section 1',
            level: 1,
            pageBreak: true,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Section content' },
            },
          ],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      expect(groups).toHaveLength(2);
      expect(groups[0].breakBefore).toBe(false);
      expect(groups[1].breakBefore).toBe(true);
    });

    it('should handle multiple sections with mixed pageBreak settings', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: {
            title: 'Section 1',
            level: 1,
            pageBreak: false,
          },
          children: [{ name: 'paragraph', props: { content: 'Content 1' } }],
        },
        {
          name: 'section',
          props: {
            title: 'Section 2',
            level: 1,
            // default pageBreak: true
          },
          children: [{ name: 'paragraph', props: { content: 'Content 2' } }],
        },
        {
          name: 'section',
          props: {
            title: 'Section 3',
            level: 1,
            pageBreak: false,
          },
          children: [{ name: 'paragraph', props: { content: 'Content 3' } }],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      // Section 1 (pageBreak: false) stays in current group
      // Section 2 (pageBreak: true) creates new group with break
      // Section 3 (pageBreak: false) continues in Section 2's group
      expect(groups).toHaveLength(2);
      // Section 1: no break (explicit false, first section)
      expect(groups[0].breakBefore).toBe(false);
      // Section 2 + 3: Section 2 has break, Section 3 stays with it
      expect(groups[1].breakBefore).toBe(true);
    });

    it('should handle consecutive sections with default pageBreak', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'section',
          props: { title: 'Section 1', level: 1 },
          children: [{ name: 'paragraph', props: { content: 'Content 1' } }],
        },
        {
          name: 'section',
          props: { title: 'Section 2', level: 1 },
          children: [{ name: 'paragraph', props: { content: 'Content 2' } }],
        },
        {
          name: 'section',
          props: { title: 'Section 3', level: 1 },
          children: [{ name: 'paragraph', props: { content: 'Content 3' } }],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      expect(groups).toHaveLength(3);
      // First section: HAS break (default pageBreak: true)
      expect(groups[0].breakBefore).toBe(true);
      // Second section: HAS break (default)
      expect(groups[1].breakBefore).toBe(true);
      // Third section: HAS break (default)
      expect(groups[2].breakBefore).toBe(true);
    });

    it('should handle titleless section with explicit pageBreak: true', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'section',
          props: {
            // No title
            pageBreak: true,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Section content without title' },
            },
          ],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      expect(groups).toHaveLength(2);
      // First group: intro text
      expect(groups[0].breakBefore).toBe(false);
      // Second group: titleless section with pageBreak
      expect(groups[1].breakBefore).toBe(true);
    });

    it('should handle titleless section with default pageBreak', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'section',
          props: {
            // No title, pageBreak defaults to true
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'TOC or other content' },
            },
          ],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      expect(groups).toHaveLength(2);
      expect(groups[0].breakBefore).toBe(false);
      // Titleless section should still get page break by default
      expect(groups[1].breakBefore).toBe(true);
    });

    it('should handle titleless section with pageBreak: false', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'section',
          props: {
            pageBreak: false,
          },
          children: [
            {
              name: 'paragraph',
              props: { content: 'Section content' },
            },
          ],
        },
      ];

      const groups = analyzeLayoutGroups(components);

      // Should be in same group (no break)
      expect(groups).toHaveLength(1);
      expect(groups[0].breakBefore).toBe(false);
      expect(groups[0].components.length).toBeGreaterThan(1);
    });
  });

  describe('Heading pageBreak', () => {
    it('should not create page break by default', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'heading',
          props: {
            text: 'Heading 1',
            level: 1,
          },
        },
      ];

      const groups = analyzeLayoutGroups(components);

      // Should be in same group (no break)
      expect(groups).toHaveLength(1);
      expect(groups[0].breakBefore).toBe(false);
      expect(groups[0].components).toHaveLength(2);
    });

    it('should create page break when pageBreak: true', () => {
      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: { content: 'Introduction' },
        },
        {
          name: 'heading',
          props: {
            text: 'Heading 1',
            level: 1,
            pageBreak: true,
          },
        },
      ];

      const groups = analyzeLayoutGroups(components);

      expect(groups).toHaveLength(2);
      expect(groups[0].breakBefore).toBe(false);
      expect(groups[1].breakBefore).toBe(true);
    });
  });
});

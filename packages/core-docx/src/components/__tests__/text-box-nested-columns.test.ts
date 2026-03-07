/**
 * Tests for nested columns inside text-box components
 */

import { describe, it, expect } from 'vitest';
import { renderTextBoxComponent } from '../text-box';
import { minimalTheme } from '../../templates/themes';
import type { TextBoxComponentDefinition, RenderContext } from '../../types';
import { Table } from 'docx';

// Mock render context
const mockContext: RenderContext = {
  theme: {
    name: 'minimal',
    colors: {},
    fonts: {},
    spacing: {},
  },
  fullTheme: minimalTheme,
  document: {
    title: 'Test',
    date: new Date(),
  },
  section: {
    currentLayout: 'single',
    columnCount: 1,
    pageNumber: 1,
  },
  utils: {
    formatDate: (date: Date) => date.toISOString(),
    parseText: (text: string) => [{ text }],
    getStyle: (name: string) => ({ name }),
  },
  depth: 0,
};

describe('Text-Box with Nested Columns', () => {
  it('should render columns as table when nested in text-box', async () => {
    const component: TextBoxComponentDefinition = {
      name: 'text-box',
      props: {
        style: {
          padding: { top: 6, right: 6, bottom: 6, left: 6 },
        },
      },
      children: [
        {
          name: 'columns',
          props: {
            columns: 2,
          },
          children: [
            {
              name: 'paragraph',
              props: {
                text: 'Column 1 content',
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Column 2 content',
              },
            },
          ],
        },
      ],
    };

    const result = await renderTextBoxComponent(
      component,
      minimalTheme,
      'minimal',
      mockContext
    );

    // Should return a single table (the text-box container)
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);

    // The table should contain nested tables (the columns rendered as a table)
    const textBoxTable = result[0] as Table;
    expect(textBoxTable).toBeDefined();
  });

  it('should render floating text-box with columns', async () => {
    const component: TextBoxComponentDefinition = {
      name: 'text-box',
      props: {
        floating: {
          horizontalPosition: { relative: 'margin', align: 'right' },
          verticalPosition: { relative: 'page', align: 'top' },
          width: 2880,
          height: 1800,
        },
      },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Header text',
          },
        },
        {
          name: 'columns',
          props: {
            columns: [{ width: '50%' }, { width: '50%' }],
          },
          children: [
            {
              name: 'paragraph',
              props: {
                text: 'Left column',
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Right column',
              },
            },
          ],
        },
      ],
    };

    const result = await renderTextBoxComponent(
      component,
      minimalTheme,
      'minimal',
      mockContext
    );

    // Should return a single floating table
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
  });

  it('should render three-column layout in text-box', async () => {
    const component: TextBoxComponentDefinition = {
      name: 'text-box',
      props: {},
      children: [
        {
          name: 'columns',
          props: {
            columns: 3,
            gap: 360,
          },
          children: [
            {
              name: 'paragraph',
              props: {
                text: 'Column 1',
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Column 2',
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Column 3',
              },
            },
          ],
        },
      ],
    };

    const result = await renderTextBoxComponent(
      component,
      minimalTheme,
      'minimal',
      mockContext
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
  });

  it('should handle mixed content with columns', async () => {
    const component: TextBoxComponentDefinition = {
      name: 'text-box',
      props: {
        style: {
          shading: { fill: '#F0F8FF' },
        },
      },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Title above columns',
          },
        },
        {
          name: 'columns',
          props: {
            columns: 2,
          },
          children: [
            {
              name: 'paragraph',
              props: {
                text: 'Text in column 1',
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Text in column 2',
              },
            },
          ],
        },
        {
          name: 'paragraph',
          props: {
            text: 'Footer below columns',
          },
        },
      ],
    };

    const result = await renderTextBoxComponent(
      component,
      minimalTheme,
      'minimal',
      mockContext
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
  });

  it('should handle custom column widths', async () => {
    const component: TextBoxComponentDefinition = {
      name: 'text-box',
      props: {},
      children: [
        {
          name: 'columns',
          props: {
            columns: [{ width: '30%', gap: 240 }, { width: '70%' }],
          },
          children: [
            {
              name: 'paragraph',
              props: {
                text: 'Narrow column',
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Wide column',
              },
            },
          ],
        },
      ],
    };

    const result = await renderTextBoxComponent(
      component,
      minimalTheme,
      'minimal',
      mockContext
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
  });
});

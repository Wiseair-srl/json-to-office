/**
 * JSON Schema for JSON to PPTX Theme definitions
 * This schema is used for Monaco Editor validation and auto-completion
 */

export const themeJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://json-to-office.dev/schemas/theme/v1.0.0',
  title: 'JSON to PPTX Theme',
  description: 'Theme definition for JSON to PPTX presentations',
  type: 'object',
  required: ['name', 'colors', 'fonts'],
  properties: {
    name: {
      type: 'string',
      description: 'Unique name for the theme',
      minLength: 1,
    },
    colors: {
      type: 'object',
      description: 'Color palette for the theme',
      required: ['primary', 'secondary', 'accent', 'background', 'text'],
      properties: {
        primary: { $ref: '#/definitions/hexColor' },
        secondary: { $ref: '#/definitions/hexColor' },
        accent: { $ref: '#/definitions/hexColor' },
        background: { $ref: '#/definitions/hexColor' },
        text: { $ref: '#/definitions/hexColor' },
      },
      additionalProperties: false,
    },
    fonts: {
      type: 'object',
      description: 'Font definitions for the theme',
      required: ['body', 'heading'],
      properties: {
        body: {
          type: 'string',
          description: 'Font family for body text',
          minLength: 1,
        },
        heading: {
          type: 'string',
          description: 'Font family for headings',
          minLength: 1,
        },
      },
      additionalProperties: false,
    },
    defaults: {
      type: 'object',
      description: 'Default text settings',
      properties: {
        fontSize: {
          type: 'number',
          description: 'Default font size in points',
          minimum: 6,
          maximum: 96,
        },
        fontColor: { $ref: '#/definitions/hexColor' },
      },
      additionalProperties: false,
    },
  },
    grid: {
      type: 'object',
      description: 'Grid layout configuration',
      properties: {
        columns: {
          type: 'number',
          description: 'Number of columns (default: 12)',
          minimum: 1,
        },
        rows: {
          type: 'number',
          description: 'Number of rows (default: 6)',
          minimum: 1,
        },
        margin: {
          description: 'Slide margins in inches',
          oneOf: [
            { type: 'number', description: 'Margin in inches (all sides)' },
            {
              type: 'object',
              properties: {
                top: { type: 'number' },
                right: { type: 'number' },
                bottom: { type: 'number' },
                left: { type: 'number' },
              },
              required: ['top', 'right', 'bottom', 'left'],
              additionalProperties: false,
            },
          ],
        },
        gutter: {
          description: 'Gaps between grid tracks in inches',
          oneOf: [
            { type: 'number', description: 'Gutter in inches (both axes)' },
            {
              type: 'object',
              properties: {
                column: { type: 'number' },
                row: { type: 'number' },
              },
              required: ['column', 'row'],
              additionalProperties: false,
            },
          ],
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
  definitions: {
    hexColor: {
      type: 'string',
      pattern: '^#?[0-9A-Fa-f]{6}$',
      description: 'Hex color (with or without #)',
    },
  },
};

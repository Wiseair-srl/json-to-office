/**
 * JSON Schema Generator for Monaco Editor
 *
 * Uses TypeBox's native JSON Schema generation for rich autocomplete.
 * Format-aware: generates docx or pptx schemas based on FORMAT.
 */
import {
  generateUnifiedDocumentSchema as generatePptxSchema,
  convertToJsonSchema as convertPptxToJsonSchema,
  PptxComponentDefinitionSchema,
  PresentationPropsSchema,
  SlidePropsSchema,
  TextPropsSchema,
  PptxImagePropsSchema,
  ShapePropsSchema,
  PptxTablePropsSchema,
  ThemeConfigSchema as PptxThemeConfigSchema,
} from '@json-to-office/shared-pptx';

import {
  generateUnifiedDocumentSchema as generateDocxSchema,
  convertToJsonSchema as convertDocxToJsonSchema,
  ComponentDefinitionSchema as DocxComponentDefinitionSchema,
  ReportPropsSchema,
  SectionPropsSchema,
  HeadingPropsSchema,
  ParagraphPropsSchema,
  ImagePropsSchema,
  TablePropsSchema as DocxTablePropsSchema,
  ThemeConfigSchema as DocxThemeConfigSchema,
} from '@json-to-office/shared-docx';

import { FORMAT } from './env';

export interface MonacoSchemaConfig {
  uri: string;
  fileMatch: string[];
  schema: any;
}

// ---------------------------------------------------------------------------
// Document schema
// ---------------------------------------------------------------------------

function generateDocxDocumentSchema(): any {
  const unified = generateDocxSchema({ customComponents: [] });
  const schema = convertDocxToJsonSchema(unified, {
    $schema: 'https://json-schema.org/draft-07/schema#',
    $id: 'https://json-to-office.dev/schema/document/v1.0.0',
    title: 'JSON to DOCX Document Definition',
    description: 'Schema for JSON to DOCX JSON document definitions',
  });

  const enhancedSchema: any = {
    ...schema,
    default: {
      name: 'docx',
      props: { title: 'New Document' },
      children: [],
    },
    properties: {
      ...(schema as any).properties,
      children: {
        ...((schema as any).properties?.children || {}),
        description:
          'Array of document components. Type "name" to see available component types.',
        markdownDescription:
          'Array of document components. Available types:\n- `docx` - Main container\n- `section` - Section container\n- `heading` - Heading element\n- `paragraph` - Paragraph element\n- `image` - Image element\n- `table` - Data table\n- `list` - List element\n- `columns` - Column layout\n- `statistic` - Statistic element\n- `highcharts` - Highcharts chart\n- `toc` - Table of contents',
      },
    },
    definitions: {
      ...((schema as any).definitions || {}),
    },
  };

  enhanceSchemaDescriptions(enhancedSchema);
  return enhancedSchema;
}

function generatePptxDocumentSchema(): any {
  const unified = generatePptxSchema({ customComponents: [] });
  const schema = convertPptxToJsonSchema(unified, {
    $schema: 'https://json-schema.org/draft-07/schema#',
    $id: 'https://json-to-office.dev/schema/presentation/v1.0.0',
    title: 'JSON to PPTX Presentation Definition',
    description: 'Schema for JSON to PPTX JSON presentation definitions',
  });

  const enhancedSchema: any = {
    ...schema,
    default: {
      name: 'pptx',
      props: { title: 'New Presentation' },
      children: [],
    },
    properties: {
      ...(schema as any).properties,
      children: {
        ...((schema as any).properties?.children || {}),
        description:
          'Array of slide components. Type "name" to see available component types.',
        markdownDescription:
          'Array of presentation components. Available types:\n- `pptx` - Main container\n- `slide` - Slide container\n- `text` - Text element\n- `image` - Image element\n- `shape` - Shape element\n- `table` - Data table\n- `highcharts` - Highcharts chart',
      },
    },
    definitions: {
      ...((schema as any).definitions || {}),
    },
  };

  enhanceSchemaDescriptions(enhancedSchema);
  return enhancedSchema;
}

/**
 * Generates JSON Schema for document/presentation definitions (format-aware)
 */
export function generateReportDefinitionSchema(): any {
  return FORMAT === 'docx'
    ? generateDocxDocumentSchema()
    : generatePptxDocumentSchema();
}

// ---------------------------------------------------------------------------
// Theme schema
// ---------------------------------------------------------------------------

/**
 * Generates JSON Schema for theme definitions (format-aware)
 */
export function generateThemeConfigSchema(): any {
  const source =
    FORMAT === 'docx' ? DocxThemeConfigSchema : PptxThemeConfigSchema;
  const schema = JSON.parse(JSON.stringify(source));
  cleanupTypeBoxIds(schema, false);

  const label = FORMAT === 'docx' ? 'DOCX' : 'PPTX';
  return {
    ...schema,
    $schema: 'https://json-schema.org/draft-07/schema#',
    $id: 'https://json-to-office.dev/schemas/theme/v1.0.0',
    title: `JSON to ${label} Theme`,
    description: `Theme definition for JSON to ${label} ${FORMAT === 'docx' ? 'documents' : 'presentations'}`,
  };
}

// ---------------------------------------------------------------------------
// Component definition schema
// ---------------------------------------------------------------------------

/**
 * Generates JSON Schema for component definitions with enhanced descriptions
 */
export function generateComponentDefinitionSchema(): any {
  const source =
    FORMAT === 'docx'
      ? DocxComponentDefinitionSchema
      : PptxComponentDefinitionSchema;
  const schema = JSON.parse(JSON.stringify(source));
  enhanceSchemaDescriptions(schema);

  const label = FORMAT === 'docx' ? 'DOCX' : 'PPTX';
  return {
    ...schema,
    $schema: 'https://json-schema.org/draft-07/schema#',
    title: 'Component Definition',
    description: `Individual component configuration for JSON to ${label}`,
  };
}

// ---------------------------------------------------------------------------
// Component schemas per type
// ---------------------------------------------------------------------------

function generateDocxComponentSchemas(): Record<string, any> {
  const componentSchemas: Record<
    string,
    { schema: any; name: string; description: string }
  > = {
    docx: {
      schema: ReportPropsSchema,
      name: 'ReportProps',
      description: 'Main document container configuration',
    },
    section: {
      schema: SectionPropsSchema,
      name: 'SectionProps',
      description: 'Section container for organizing content',
    },
    heading: {
      schema: HeadingPropsSchema,
      name: 'HeadingProps',
      description: 'Heading element with level and formatting',
    },
    paragraph: {
      schema: ParagraphPropsSchema,
      name: 'ParagraphProps',
      description: 'Paragraph element with text and formatting',
    },
    image: {
      schema: ImagePropsSchema,
      name: 'ImageProps',
      description: 'Image element with sizing and positioning',
    },
    table: {
      schema: DocxTablePropsSchema,
      name: 'TableProps',
      description: 'Tabular data display with rows and columns',
    },
  };

  return buildComponentResult(componentSchemas);
}

function generatePptxComponentSchemas(): Record<string, any> {
  const componentSchemas: Record<
    string,
    { schema: any; name: string; description: string }
  > = {
    pptx: {
      schema: PresentationPropsSchema,
      name: 'PresentationProps',
      description: 'Main presentation container configuration',
    },
    slide: {
      schema: SlidePropsSchema,
      name: 'SlideProps',
      description: 'Slide container for organizing content',
    },
    text: {
      schema: TextPropsSchema,
      name: 'TextProps',
      description: 'Text element with formatting and positioning',
    },
    image: {
      schema: PptxImagePropsSchema,
      name: 'ImageProps',
      description: 'Image element with sizing and positioning',
    },
    shape: {
      schema: ShapePropsSchema,
      name: 'ShapeProps',
      description: 'Geometric shape with optional text and styling',
    },
    table: {
      schema: PptxTablePropsSchema,
      name: 'TableProps',
      description: 'Tabular data display with rows and columns',
    },
  };

  return buildComponentResult(componentSchemas);
}

function buildComponentResult(
  componentSchemas: Record<
    string,
    { schema: any; name: string; description: string }
  >
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [type, config] of Object.entries(componentSchemas)) {
    const schema = JSON.parse(JSON.stringify(config.schema));
    result[type] = {
      ...schema,
      title: config.name,
      description: config.description,
    };
  }
  return result;
}

/**
 * Generates schemas for all component types (format-aware)
 */
export function generateComponentSchemas(): Record<string, any> {
  return FORMAT === 'docx'
    ? generateDocxComponentSchemas()
    : generatePptxComponentSchemas();
}

// ---------------------------------------------------------------------------
// Monaco schema configs
// ---------------------------------------------------------------------------

/**
 * Creates Monaco editor schema configuration for document/presentation definitions
 */
export function createReportSchemaConfig(
  filePatterns: string[] = FORMAT === 'docx' ? ['*.docx.json'] : ['*.pptx.json']
): MonacoSchemaConfig {
  return {
    uri: 'https://json-to-office.dev/schema/report/v1.0.0',
    fileMatch: filePatterns,
    schema: generateReportDefinitionSchema(),
  };
}

/**
 * Creates Monaco editor schema configuration for theme definitions
 */
export function createThemeSchemaConfig(
  filePatterns: string[] = [`*.${FORMAT}.theme.json`]
): MonacoSchemaConfig {
  return {
    uri: 'https://json-to-office.dev/schemas/theme/v1.0.0',
    fileMatch: filePatterns,
    schema: generateThemeConfigSchema(),
  };
}

/**
 * Generates a complete schema configuration for Monaco editor
 */
export function generateMonacoSchemaConfigs(): MonacoSchemaConfig[] {
  return [createReportSchemaConfig(), createThemeSchemaConfig()];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enhanceSchemaDescriptions(schema: any): void {
  if (typeof schema !== 'object' || schema === null) return;

  if (schema.anyOf) {
    schema.anyOf.forEach((subSchema: any) => {
      if (subSchema.properties?.name?.const) {
        const componentType = subSchema.properties.name?.const;
        subSchema.description = getComponentDescription(componentType);

        if (subSchema.properties?.props) {
          enhancePropsDescriptions(componentType, subSchema.properties.props);
        }
      }
    });
  }

  Object.values(schema).forEach((value) => {
    if (typeof value === 'object' && value !== null) {
      enhanceSchemaDescriptions(value);
    }
  });
}

function getComponentDescription(type: string): string {
  const descriptions: Record<string, string> = {
    // docx
    docx: 'Main document container - defines the overall document structure.',
    section: 'Section container - groups content within a document section.',
    heading: 'Heading element - displays headings with level and formatting.',
    paragraph: 'Paragraph element - displays text with formatting.',
    columns: 'Column layout - arranges content in multiple columns.',
    list: 'List element - displays ordered or unordered lists.',
    statistic: 'Statistic element - displays key metrics.',
    highcharts: 'Highcharts chart - renders a chart from Highcharts options.',
    toc: 'Table of contents - generates a document TOC.',
    'text-box': 'Text box element - a positioned box with text content.',
    // pptx
    pptx: 'Main presentation container - defines the overall presentation structure.',
    slide: 'Slide container - groups content elements within a single slide.',
    text: 'Text element - displays text with formatting and positioning.',
    shape: 'Shape element - geometric shapes with optional text and styling.',
    // shared
    image: 'Image element - displays images with sizing and positioning.',
    table: 'Table element - displays tabular data with headers and rows.',
    custom:
      'Custom component - user-defined component type for specialized content.',
  };

  return descriptions[type] || `${type} component`;
}

function enhancePropsDescriptions(
  componentType: string,
  propsSchema: any
): void {
  if (!propsSchema.properties) return;

  const propertyDescriptions: Record<string, Record<string, string>> = {
    // pptx
    text: {
      text: 'The text content to display',
      fontSize: 'Font size in points',
      bold: 'Whether to bold the text',
      color: 'Text color as hex string',
      align: 'Text alignment',
    },
    shape: {
      type: 'Shape type (rect, ellipse, etc.)',
      text: 'Text content inside the shape',
      fill: 'Fill color',
    },
    // docx
    heading: {
      text: 'The heading text',
      level: 'Heading level (1-6)',
    },
    paragraph: {
      text: 'The paragraph text content',
    },
    // shared
    image: {
      path: 'Path or URL to the image',
      w: 'Image width in inches',
      h: 'Image height in inches',
    },
    table: {
      rows: 'Array of rows, each containing cell values',
      colW: 'Column widths',
    },
  };

  const descriptions = propertyDescriptions[componentType];
  if (descriptions) {
    Object.entries(descriptions).forEach(([prop, desc]) => {
      if (propsSchema.properties[prop]) {
        propsSchema.properties[prop].description = desc;
      }
    });
  }
}

function cleanupTypeBoxIds(schema: any, hasDefinitions = true): void {
  if (typeof schema !== 'object' || schema === null) return;

  if (schema.$id && /^T\d+$/.test(schema.$id)) {
    delete schema.$id;
  }

  if (schema.$ref && /^T\d+$/.test(schema.$ref)) {
    if (hasDefinitions) {
      schema.$ref = '#/definitions/ComponentDefinition';
    } else {
      // Theme schemas have no $ref — this is a safety guard
      delete schema.$ref;
    }
  }

  if (Array.isArray(schema)) {
    schema.forEach((item) => cleanupTypeBoxIds(item, hasDefinitions));
    return;
  }

  Object.keys(schema).forEach((key) => {
    if (typeof schema[key] === 'object' && schema[key] !== null) {
      cleanupTypeBoxIds(schema[key], hasDefinitions);
    }
  });
}

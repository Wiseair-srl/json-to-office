import * as fs from 'fs/promises';
import type { TSchema } from '@sinclair/typebox';
import type { FormatName } from '../format-adapter.js';

export class TypeBoxExporter {
  private formatName: FormatName;

  constructor(formatName: FormatName = 'docx') {
    this.formatName = formatName;
  }

  private get sharedPackage(): string {
    return this.formatName === 'docx'
      ? '@json-to-office/shared-docx'
      : '@json-to-office/shared-pptx';
  }

  async exportDocumentSchema(
    schema: TSchema,
    outputPath: string,
    customComponents: Array<{ name: string; propsSchema: TSchema }>
  ): Promise<void> {
    const hasCustomComponents = customComponents.length > 0;

    const content = [
      '/**',
      ` * Generated TypeBox Document Schema (${this.formatName.toUpperCase()})`,
      hasCustomComponents
        ? ' * Includes standard components and custom plugin components'
        : ' * Includes standard components only',
      ' * Generated on: ' + new Date().toISOString(),
      ' */',
      '',
      'import { Type, type Static } from \'@sinclair/typebox\';',
      `// Import component schemas from '${this.sharedPackage}'`,
      '',
      'export const DocumentSchema = Type.Any(); // TODO: generate full recursive schema',
      '',
      'export type DocumentType = Static<typeof DocumentSchema>;',
      '',
    ].join('\n');

    await fs.writeFile(outputPath, content, 'utf-8');
  }

  async exportThemeSchema(schema: TSchema, outputPath: string): Promise<void> {
    const content = [
      '/**',
      ` * Generated TypeBox Theme Schema (${this.formatName.toUpperCase()})`,
      ' * Generated on: ' + new Date().toISOString(),
      ' */',
      '',
      'import { type Static } from \'@sinclair/typebox\';',
      '',
      `export { ThemeConfigSchema } from '${this.sharedPackage}';`,
      '',
      `import { ThemeConfigSchema } from '${this.sharedPackage}';`,
      'export type ThemeType = Static<typeof ThemeConfigSchema>;',
      '',
    ].join('\n');

    await fs.writeFile(outputPath, content, 'utf-8');
  }

  async exportComponentSchema(
    componentName: string,
    schema: TSchema,
    outputPath: string,
    metadata?: { title?: string; description?: string }
  ): Promise<void> {
    const pascalName = this.toPascalCase(componentName);

    const content = [
      '/**',
      ` * Generated TypeBox Component Schema: ${componentName}`,
      metadata?.description ? ` * ${metadata.description}` : '',
      ' * Generated on: ' + new Date().toISOString(),
      ' */',
      '',
      'import { Type, type Static } from \'@sinclair/typebox\';',
      '',
      `export const ${pascalName}ComponentSchema = Type.Object({`,
      `  name: Type.Literal('${componentName}'),`,
      '  id: Type.Optional(Type.String()),',
      '  props: Type.Any(),',
      '});',
      '',
      `export type ${pascalName}ComponentType = Static<typeof ${pascalName}ComponentSchema>;`,
      '',
    ]
      .filter((line) => line !== '')
      .join('\n');

    await fs.writeFile(outputPath, content, 'utf-8');
  }

  private toPascalCase(str: string): string {
    return str
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }
}

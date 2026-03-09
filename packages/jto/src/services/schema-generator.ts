import * as path from 'path';
import * as fs from 'fs/promises';
import { PluginRegistry } from './plugin-registry.js';
import { TypeBoxExporter } from './typebox-exporter.js';
import type { CustomComponent } from './plugin-loader.js';
import type { TSchema } from '@sinclair/typebox';
import type { FormatName } from '../format-adapter.js';

export interface SchemaGenerateOptions {
  includeDocument?: boolean;
  includeTheme?: boolean;
  split?: boolean;
  format?: 'json' | 'typebox';
}

export interface SchemaGenerateResults {
  document?: string;
  theme?: string;
  components?: string[];
}

export class SchemaGenerator {
  private registry: PluginRegistry;
  private typeboxExporter: TypeBoxExporter;
  private formatName: FormatName;

  constructor(formatName: FormatName = 'docx') {
    this.registry = PluginRegistry.getInstance();
    this.typeboxExporter = new TypeBoxExporter(formatName);
    this.formatName = formatName;
  }

  async generateAndExportSchemas(
    outputDir: string,
    options: SchemaGenerateOptions = {}
  ): Promise<SchemaGenerateResults> {
    const {
      includeDocument = true,
      includeTheme = true,
      split = false,
      format = 'json',
    } = options;

    const results: SchemaGenerateResults = {};

    await fs.mkdir(outputDir, { recursive: true });

    const customComponents = this.getCustomComponents();

    if (includeDocument) {
      const documentPath = await this.generateDocumentSchema(
        outputDir,
        customComponents,
        format
      );
      results.document = documentPath;
    }

    if (includeTheme) {
      const themePath = await this.generateThemeSchema(outputDir, format);
      results.theme = themePath;
    }

    if (split) {
      const componentPaths = await this.generateComponentSchemas(
        outputDir,
        customComponents,
        format
      );
      results.components = componentPaths;
    }

    return results;
  }

  private async generateDocumentSchema(
    outputDir: string,
    customComponents: Array<{
      name: string;
      propsSchema: TSchema;
      hasChildren?: boolean;
      versionedProps?: Array<{
        version: string;
        propsSchema: TSchema;
        hasChildren?: boolean;
      }>;
    }>,
    format: 'json' | 'typebox'
  ): Promise<string> {
    if (this.formatName === 'docx') {
      const { generateUnifiedDocumentSchema } = await import(
        '@json-to-office/shared-docx'
      );
      const schema = generateUnifiedDocumentSchema({
        includeStandardComponents: true,
        includeTheme: false,
        customComponents: customComponents.map((m) => ({
          name: m.name,
          propsSchema: m.propsSchema,
          hasChildren: m.hasChildren,
          versionedProps: m.versionedProps,
        })),
        title: 'JSON Document Definition',
        description:
          customComponents.length > 0
            ? 'Document definition with standard and custom plugin components'
            : 'Document definition with standard components',
      });

      if (format === 'json') {
        const { convertToJsonSchema, exportSchemaToFile } = await import(
          '@json-to-office/shared'
        );
        const jsonSchema = convertToJsonSchema(schema, {
          $id: 'document.schema.json',
        });
        const outputPath = path.join(outputDir, 'document.schema.json');
        await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint: true });
        return outputPath;
      } else {
        const outputPath = path.join(outputDir, 'document.schema.ts');
        await this.typeboxExporter.exportDocumentSchema(
          schema,
          outputPath,
          customComponents
        );
        return outputPath;
      }
    } else {
      // PPTX schema generation — different CustomComponentInfo shape
      const { generateUnifiedDocumentSchema } = await import(
        '@json-to-office/shared-pptx'
      );

      const schema = generateUnifiedDocumentSchema({
        customComponents: customComponents.map((m) => ({
          name: m.name,
          versions: m.versionedProps
            ? m.versionedProps.map((vp) => ({
              version: vp.version,
              propsSchema: vp.propsSchema,
              hasChildren: vp.hasChildren,
            }))
            : [
              {
                version: '1.0.0',
                propsSchema: m.propsSchema,
                hasChildren: m.hasChildren,
              },
            ],
        })),
      });

      if (format === 'json') {
        const { convertToJsonSchema, exportSchemaToFile } = await import(
          '@json-to-office/shared'
        );
        const jsonSchema = convertToJsonSchema(schema, {
          $id: 'presentation.schema.json',
        });
        const outputPath = path.join(outputDir, 'presentation.schema.json');
        await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint: true });
        return outputPath;
      } else {
        const outputPath = path.join(outputDir, 'presentation.schema.ts');
        await this.typeboxExporter.exportDocumentSchema(
          schema,
          outputPath,
          customComponents
        );
        return outputPath;
      }
    }
  }

  private async generateThemeSchema(
    outputDir: string,
    format: 'json' | 'typebox'
  ): Promise<string> {
    const sharedPkg =
      this.formatName === 'docx'
        ? '@json-to-office/shared-docx'
        : '@json-to-office/shared-pptx';

    const shared = await import(sharedPkg);
    const ThemeConfigSchema = shared.ThemeConfigSchema;

    if (format === 'json') {
      const { convertToJsonSchema, exportSchemaToFile } = await import(
        '@json-to-office/shared'
      );
      const jsonSchema = convertToJsonSchema(ThemeConfigSchema, {
        $id: 'theme.schema.json',
        title: 'Theme Configuration',
        description: 'Theme configuration for styling',
      });

      const outputPath = path.join(outputDir, 'theme.schema.json');
      await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint: true });
      return outputPath;
    } else {
      const outputPath = path.join(outputDir, 'theme.schema.ts');
      await this.typeboxExporter.exportThemeSchema(
        ThemeConfigSchema,
        outputPath
      );
      return outputPath;
    }
  }

  private async generateComponentSchemas(
    outputDir: string,
    customComponents: Array<{ name: string; propsSchema: TSchema }>,
    format: 'json' | 'typebox'
  ): Promise<string[]> {
    const componentsDir = path.join(outputDir, 'components');
    await fs.mkdir(componentsDir, { recursive: true });

    const paths: string[] = [];

    // Get standard components based on format
    const standardComponents = await this.getStandardComponentSchemas();

    for (const [type, schema] of Object.entries(standardComponents)) {
      if (format === 'json') {
        const { convertToJsonSchema, exportSchemaToFile } = await import(
          '@json-to-office/shared'
        );
        const jsonSchema = convertToJsonSchema(schema, {
          $id: `${type}.schema.json`,
          title: `${type} Component`,
          description: `${type} component configuration`,
        });
        const outputPath = path.join(componentsDir, `${type}.schema.json`);
        await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint: true });
        paths.push(outputPath);
      } else {
        const outputPath = path.join(componentsDir, `${type}.schema.ts`);
        await this.typeboxExporter.exportComponentSchema(type, schema, outputPath);
        paths.push(outputPath);
      }
    }

    // Custom component schemas
    for (const customComponent of customComponents) {
      if (format === 'json') {
        const { convertToJsonSchema, exportSchemaToFile } = await import(
          '@json-to-office/shared'
        );
        const jsonSchema = convertToJsonSchema(customComponent.propsSchema, {
          $id: `${customComponent.name}.schema.json`,
          title: `${customComponent.name} Component`,
          description: `Custom ${customComponent.name} component configuration`,
        });
        const outputPath = path.join(
          componentsDir,
          `${customComponent.name}.schema.json`
        );
        await exportSchemaToFile(jsonSchema, outputPath, { prettyPrint: true });
        paths.push(outputPath);
      } else {
        const outputPath = path.join(
          componentsDir,
          `${customComponent.name}.schema.ts`
        );
        await this.typeboxExporter.exportComponentSchema(
          customComponent.name,
          customComponent.propsSchema,
          outputPath
        );
        paths.push(outputPath);
      }
    }

    return paths;
  }

  private async getStandardComponentSchemas(): Promise<Record<string, TSchema>> {
    if (this.formatName === 'docx') {
      const shared = await import('@json-to-office/shared-docx');
      return {
        report: shared.ReportPropsSchema,
        section: shared.SectionPropsSchema,
        columns: shared.ColumnsPropsSchema,
        heading: shared.HeadingPropsSchema,
        paragraph: shared.ParagraphPropsSchema,
        image: shared.ImagePropsSchema,
        statistic: shared.StatisticPropsSchema,
        table: shared.TablePropsSchema,
        header: shared.HeaderPropsSchema,
        footer: shared.FooterPropsSchema,
        list: shared.ListPropsSchema,
      };
    } else {
      const shared = await import('@json-to-office/shared-pptx');
      return {
        presentation: shared.PresentationPropsSchema,
        slide: shared.SlidePropsSchema,
        text: shared.TextPropsSchema,
        image: shared.PptxImagePropsSchema,
        shape: shared.ShapePropsSchema,
        table: shared.PptxTablePropsSchema,
      };
    }
  }

  private getCustomComponents(): Array<{
    name: string;
    propsSchema: TSchema;
    hasChildren?: boolean;
    versionedProps?: Array<{
      version: string;
      propsSchema: TSchema;
      hasChildren?: boolean;
    }>;
  }> {
    const loadedPlugins = this.registry.getPlugins();
    const customComponents: Array<{
      name: string;
      propsSchema: TSchema;
      hasChildren?: boolean;
      versionedProps?: Array<{
        version: string;
        propsSchema: TSchema;
        hasChildren?: boolean;
      }>;
    }> = [];

    for (const plugin of loadedPlugins) {
      const component = plugin as unknown as CustomComponent;
      const versions = (component as any).versions;
      if (component.name && versions && typeof versions === 'object') {
        const versionKeys = Object.keys(versions);
        if (versionKeys.length > 0) {
          const versionedProps = versionKeys.map((v: string) => ({
            version: v,
            propsSchema: versions[v].propsSchema as TSchema,
            hasChildren: versions[v].hasChildren === true,
          }));

          const hasChildren = versionKeys.some(
            (v: string) => versions[v].hasChildren === true
          );
          const latestKey = versionKeys.reduce((a, b) => (a > b ? a : b));

          customComponents.push({
            name: component.name,
            propsSchema: versions[latestKey].propsSchema as TSchema,
            hasChildren,
            versionedProps,
          });
        }
      }
    }

    return customComponents;
  }
}

import * as path from 'path';
import * as fs from 'fs/promises';
import { type TSchema } from '@sinclair/typebox';
import { latestVersion } from '@json-to-office/shared';
import type { CustomComponent } from './plugin-loader.js';

export interface PluginExample {
  title?: string;
  props: any;
  description?: string;
}

export interface PluginMetadata {
  name: string;
  description?: string;
  version?: string;
  filePath: string;
  relativePath: string;
  location: 'upstream' | 'downstream' | 'current';
  hasChildren?: boolean;
  schema: {
    raw: TSchema;
    jsonSchema?: any;
    properties?: Record<string, any>;
  };
  examples?: PluginExample[];
}

export class PluginMetadataExtractor {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async extract(
    component: CustomComponent,
    filePath: string
  ): Promise<PluginMetadata> {
    const location = this.determineLocation(filePath);
    const relativePath = path.relative(this.cwd, filePath);

    const versions = (component as any).versions || {};
    const versionKeys = Object.keys(versions);
    const latestVer =
      versionKeys.length > 0 ? latestVersion(versionKeys) : undefined;
    const latestEntry = latestVer ? versions[latestVer] : undefined;

    const metadata: PluginMetadata = {
      name: component.name,
      description: latestEntry?.description,
      version: latestVer,
      filePath,
      relativePath,
      location,
      hasChildren: latestEntry?.hasChildren === true,
      schema: {
        raw: latestEntry?.propsSchema,
      },
    };

    if (latestEntry?.propsSchema) {
      try {
        metadata.schema.jsonSchema = this.typeboxToJsonSchema(
          latestEntry.propsSchema
        );
        metadata.schema.properties = this.extractProperties(
          latestEntry.propsSchema
        );
      } catch {}
    }

    try {
      metadata.examples = await this.extractExamples(filePath);
    } catch {
      metadata.examples = [];
    }

    return metadata;
  }

  private determineLocation(
    filePath: string
  ): 'upstream' | 'downstream' | 'current' {
    const resolvedPath = path.resolve(filePath);
    const resolvedCwd = path.resolve(this.cwd);

    if (path.dirname(resolvedPath) === resolvedCwd) {
      return 'current';
    }

    if (resolvedPath.startsWith(resolvedCwd)) {
      return 'downstream';
    }

    return 'upstream';
  }

  private typeboxToJsonSchema(schema: TSchema): any {
    try {
      const jsonSchema = JSON.parse(JSON.stringify(schema));
      delete jsonSchema[Symbol.for('TypeBox.Kind')];
      delete jsonSchema.static;
      return jsonSchema;
    } catch {
      return schema;
    }
  }

  private extractProperties(schema: TSchema): Record<string, any> {
    const properties: Record<string, any> = {};

    try {
      if (schema.type === 'object' && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          const prop: any = value as any;
          let type = prop.type || 'unknown';
          let enumValues: any[] | undefined;

          if (prop.anyOf && Array.isArray(prop.anyOf)) {
            const literals = prop.anyOf
              .filter(
                (item: any) =>
                  item.type === 'string' && item.const !== undefined
              )
              .map((item: any) => item.const);

            if (literals.length > 0) {
              type = 'string';
              enumValues = literals;
            } else {
              const types = prop.anyOf
                .map((item: any) => item.type)
                .filter(Boolean);
              type = types.length > 0 ? types.join(' | ') : 'union';
            }
          }

          properties[key] = {
            type,
            description: prop.description,
            required: schema.required?.includes(key) || false,
            default: prop.default,
            enum: enumValues || prop.enum,
            pattern: prop.pattern,
            minimum: prop.minimum,
            maximum: prop.maximum,
            minLength: prop.minLength,
            maxLength: prop.maxLength,
          };

          Object.keys(properties[key]).forEach((k) => {
            if (properties[key][k] === undefined) {
              delete properties[key][k];
            }
          });
        }
      }
    } catch {}

    return properties;
  }

  private async extractExamples(filePath: string): Promise<PluginExample[]> {
    const examples: PluginExample[] = [];
    const normalizeExampleProps = (input: any) => {
      if (input && typeof input === 'object' && 'props' in input) {
        return (input as { props: any }).props;
      }
      return input;
    };

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      const exampleRegex =
        /@example\s*(?:<caption>(.*?)<\/caption>)?\s*\*?\s*```(?:json|typescript|ts)?\s*([\s\S]*?)```/gi;
      let match;

      while ((match = exampleRegex.exec(content)) !== null) {
        const title = match[1]?.trim();
        let codeBlock = match[2];

        codeBlock = codeBlock
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, ''))
          .join('\n')
          .trim();

        const jsonMatch = codeBlock.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const props = JSON.parse(jsonMatch[0]);
            examples.push({
              title,
              props: normalizeExampleProps(props),
            });
          } catch {
            const propsMatch = codeBlock.match(/props:\s*\{[\s\S]*?\}/);
            if (propsMatch) {
              try {
                const configStr = propsMatch[0].replace(/props:\s*/, '');
                const cleanConfig = configStr
                  .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
                  .replace(/'/g, '"')
                  .replace(/,(\s*[}\]])/g, '$1')
                  .replace(/,\s*$/, '');
                const props = JSON.parse(cleanConfig);
                examples.push({ title, props });
              } catch {}
            }
          }
        }
      }

      const inlineExampleRegex = /\/\/\s*Example:\s*(\{.*?\})/g;
      while ((match = inlineExampleRegex.exec(content)) !== null) {
        try {
          const props = JSON.parse(match[1]);
          examples.push({ props: normalizeExampleProps(props) });
        } catch {}
      }
    } catch {}

    return examples;
  }

  async extractBatch(
    components: Map<string, CustomComponent>
  ): Promise<PluginMetadata[]> {
    const metadataList: PluginMetadata[] = [];

    for (const [filePath, component] of components) {
      try {
        const metadata = await this.extract(component, filePath);
        metadataList.push(metadata);
      } catch (error) {
        console.warn(`Failed to extract metadata from ${filePath}:`, error);
      }
    }

    return metadataList;
  }
}

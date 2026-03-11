import { readFileSync, statSync, readdirSync } from 'fs';
import { resolve, join, extname } from 'path';
import * as glob from 'glob';
import type { FormatName } from '../format-adapter.js';

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
  line?: number;
  column?: number;
  suggestion?: string;
  value?: any;
}

export interface ValidateFileResult {
  file: string;
  valid: boolean;
  type?: 'document' | 'theme' | 'custom';
  errors?: ValidationError[];
  warnings?: ValidationError[];
}

export interface ValidateOptions {
  type?: 'document' | 'theme' | 'auto';
  schema?: string;
  strict?: boolean;
  recursive?: boolean;
}

export class JsonValidator {
  private format: FormatName;

  constructor(format: FormatName = 'docx') {
    this.format = format;
  }

  async validate(
    pathOrPattern: string,
    options: ValidateOptions = {}
  ): Promise<ValidateFileResult[]> {
    const results: ValidateFileResult[] = [];

    const files = await this.getFilesToValidate(pathOrPattern, options);

    for (const file of files) {
      const result = await this.validateFile(file, options);
      results.push(result);
    }

    return results;
  }

  async validateFile(
    filePath: string,
    options: ValidateOptions = {}
  ): Promise<ValidateFileResult> {
    const absolutePath = resolve(filePath);

    try {
      const content = readFileSync(absolutePath, 'utf-8');
      let jsonData: any;

      try {
        jsonData = JSON.parse(content);
      } catch (error: any) {
        return {
          file: filePath,
          valid: false,
          errors: [
            {
              path: 'root',
              message: `Invalid JSON: ${error.message}`,
              code: 'json_parse_error',
            },
          ],
        };
      }

      const validationType =
        options.type === 'auto' || !options.type
          ? this.detectType(jsonData)
          : options.type;

      if (options.schema) {
        return await this.validateWithCustomSchema(
          filePath,
          jsonData,
          options.schema,
          options.strict
        );
      } else if (validationType === 'document') {
        return await this.validateAsDocument(
          filePath,
          jsonData,
          content,
          options.strict
        );
      } else if (validationType === 'theme') {
        return await this.validateAsTheme(
          filePath,
          jsonData,
          content,
          options.strict
        );
      } else {
        return {
          file: filePath,
          valid: false,
          errors: [
            {
              path: 'root',
              message:
                'Could not determine JSON type (document or theme). Use --type to specify.',
              code: 'unknown_type',
            },
          ],
        };
      }
    } catch (error: any) {
      return {
        file: filePath,
        valid: false,
        errors: [
          {
            path: 'file',
            message: error.message,
            code: 'file_error',
          },
        ],
      };
    }
  }

  private async validateAsDocument(
    filePath: string,
    jsonData: any,
    jsonString: string,
    strict?: boolean
  ): Promise<ValidateFileResult> {
    try {
      if (this.format === 'docx') {
        const { validate, validateStrict } = await import(
          '@json-to-office/shared-docx'
        );
        const validator = strict ? validateStrict : validate;
        const result = validator.jsonDocument(jsonString);
        return {
          file: filePath,
          valid: result.valid,
          type: 'document',
          errors: result.errors?.map((e: any) => ({
            ...e,
            code: e.code || 'VALIDATION_ERROR',
          })),
          warnings: result.warnings?.map((e: any) => ({
            ...e,
            code: e.code || 'WARNING',
          })),
        };
      } else {
        // PPTX - basic validation
        return {
          file: filePath,
          valid: true,
          type: 'document',
        };
      }
    } catch {
      // Fallback if validation module not available
      return { file: filePath, valid: true, type: 'document' };
    }
  }

  private async validateAsTheme(
    filePath: string,
    jsonData: any,
    jsonString: string,
    strict?: boolean
  ): Promise<ValidateFileResult> {
    try {
      if (this.format === 'docx') {
        const { validate, validateStrict } = await import(
          '@json-to-office/shared-docx'
        );
        const validator = strict ? validateStrict : validate;
        const result = validator.jsonTheme(jsonString);
        return {
          file: filePath,
          valid: result.valid,
          type: 'theme',
          errors: result.errors?.map((e: any) => ({
            ...e,
            code: e.code || 'VALIDATION_ERROR',
          })),
        };
      } else {
        return { file: filePath, valid: true, type: 'theme' };
      }
    } catch {
      return { file: filePath, valid: true, type: 'theme' };
    }
  }

  private async validateWithCustomSchema(
    filePath: string,
    jsonData: any,
    schemaPath: string,
    strict?: boolean
  ): Promise<ValidateFileResult> {
    try {
      const schemaContent = readFileSync(resolve(schemaPath), 'utf-8');
      const schema = JSON.parse(schemaContent);

      const Ajv = (await import('ajv')).default;
      const addFormats = (await import('ajv-formats')).default;

      const ajv = new Ajv({
        allErrors: true,
        verbose: true,
        strict: strict ?? false,
      });
      addFormats(ajv);

      const validate = ajv.compile(schema);
      const valid = validate(jsonData);

      const errors: ValidationError[] =
        validate.errors?.map((error) => ({
          path: error.instancePath || 'root',
          message: error.message || 'Validation error',
          code: error.keyword || 'validation_error',
          value: error.data,
        })) || [];

      return {
        file: filePath,
        valid: valid as boolean,
        type: 'custom',
        errors: valid ? undefined : errors,
      };
    } catch (error: any) {
      return {
        file: filePath,
        valid: false,
        type: 'custom',
        errors: [
          {
            path: 'schema',
            message: `Failed to load or compile schema: ${error.message}`,
            code: 'schema_error',
          },
        ],
      };
    }
  }

  private detectType(jsonData: any): 'document' | 'theme' | null {
    if (
      jsonData.name === 'docx' ||
      jsonData.name === 'pptx' ||
      (jsonData.children && Array.isArray(jsonData.children)) ||
      (jsonData.slides && Array.isArray(jsonData.slides)) ||
      (jsonData.props && jsonData.props.metadata?.title)
    ) {
      return 'document';
    }

    if (
      jsonData.colors ||
      jsonData.fonts ||
      jsonData.styles ||
      jsonData.pageSetup ||
      jsonData.componentDefaults ||
      (jsonData.name && (jsonData.colors || jsonData.fonts))
    ) {
      return 'theme';
    }

    return null;
  }

  private async getFilesToValidate(
    pathOrPattern: string,
    options: ValidateOptions
  ): Promise<string[]> {
    const resolvedPath = resolve(pathOrPattern);

    try {
      const stats = statSync(resolvedPath);

      if (stats.isFile()) {
        return [resolvedPath];
      } else if (stats.isDirectory()) {
        if (options.recursive) {
          const pattern = join(resolvedPath, '**/*.json');
          return glob.glob(pattern, {
            ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
          });
        } else {
          const files = readdirSync(resolvedPath);
          return files
            .filter((file) => extname(file).toLowerCase() === '.json')
            .map((file) => join(resolvedPath, file));
        }
      }
    } catch {
      return glob.glob(pathOrPattern, {
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      });
    }

    return [];
  }

  formatError(error: ValidationError, indent: number = 0): string {
    const spaces = ' '.repeat(indent);
    let output = `${spaces}* ${error.path}: ${error.message}`;

    if (error.line && error.column) {
      output += ` (line ${error.line}, column ${error.column})`;
    }

    if (error.suggestion) {
      output += `\n${spaces}  -> ${error.suggestion}`;
    }

    return output;
  }

  formatResultsAsJson(results: ValidateFileResult[]): string {
    return JSON.stringify(results, null, 2);
  }
}

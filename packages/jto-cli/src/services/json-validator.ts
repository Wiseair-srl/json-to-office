import { readFileSync, statSync, readdirSync } from 'fs';
import { resolve, join, extname } from 'path';
import { glob } from 'glob';
import type {
  FormatAdapter,
  FormatName,
  GeneratorOptions,
} from '@json-to-office/jto-ops';

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
  severity?: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  suggestion?: string;
  value?: any;
  source?: string;
  ruleId?: string;
  category?: string;
  certainty?: string;
  relatedPaths?: readonly string[];
  evidence?: unknown;
  fixes?: readonly unknown[];
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
  quality?: GeneratorOptions['quality'];
}

export class JsonValidator {
  private format: FormatName;
  private adapter?: FormatAdapter;

  constructor(format: FormatName = 'docx', adapter?: FormatAdapter) {
    this.format = format;
    this.adapter = adapter;
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
          options
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
    options: ValidateOptions
  ): Promise<ValidateFileResult> {
    try {
      const { validate, validateStrict } =
        this.format === 'docx'
          ? await import('@json-to-office/shared-docx')
          : await import('@json-to-office/shared-pptx');
      const validator = options.strict ? validateStrict : validate;
      const result = validator.jsonDocument(jsonString);
      const schemaWarnings = (result as any).warnings?.map((e: any) => ({
        ...e,
        code: e.code || 'WARNING',
      }));
      if (!result.valid) {
        const errors = result.errors?.map((e: any) => ({
          ...e,
          code: e.code || 'VALIDATION_ERROR',
        }));
        return {
          file: filePath,
          valid: false,
          type: 'document',
          ...(errors?.length && { errors }),
          ...(schemaWarnings?.length && { warnings: schemaWarnings }),
        };
      }
      const qualityNotices: ValidationError[] = [];
      let analyzed:
        | Awaited<ReturnType<NonNullable<FormatAdapter['analyzeQuality']>>>
        | undefined;
      try {
        analyzed = this.adapter?.analyzeQuality
          ? await this.adapter.analyzeQuality(jsonData, {
              quality: options.quality,
            })
          : undefined;
      } catch (error: any) {
        // Quality analysis is advisory; a throw here must not take the schema
        // errors down with it.
        qualityNotices.push({
          path: 'root',
          message: `Quality analysis unavailable: ${error?.message ?? error}`,
          code: 'quality_unavailable',
        });
      }
      // Const so the partition below keeps its narrowing inside the callbacks.
      const analysis = analyzed;
      // A rule that threw is dropped by the engine's default `continue`, which
      // silently removes its whole finding class — say so rather than report
      // the file clean.
      for (const ruleError of analysis?.ruleErrors ?? []) {
        qualityNotices.push({
          path: 'root',
          message: `Quality rule ${ruleError.ruleId} failed: ${ruleError.message}`,
          code: 'quality_rule_error',
          ruleId: ruleError.ruleId,
        });
      }
      const quality = analysis?.diagnostics ?? [];
      const qualityEntries = quality.map((finding) => ({
        path: finding.path,
        message: finding.message,
        code: finding.code,
        severity: finding.severity,
        suggestion: finding.suggestion,
        value: finding.context,
        ...('source' in finding && { source: finding.source }),
        ...('ruleId' in finding && { ruleId: finding.ruleId }),
        ...('category' in finding && { category: finding.category }),
        ...('certainty' in finding && { certainty: finding.certainty }),
        ...('relatedPaths' in finding && {
          relatedPaths: finding.relatedPaths,
        }),
        ...('evidence' in finding && { evidence: finding.evidence }),
        ...('fixes' in finding && { fixes: finding.fixes }),
      }));
      const qualityErrors = analysis?.blocked
        ? qualityEntries.filter(
            (_, index) => analysis.diagnostics[index].blocking
          )
        : [];
      const qualityWarnings = analysis?.blocked
        ? qualityEntries.filter(
            (_, index) => !analysis.diagnostics[index].blocking
          )
        : qualityEntries;
      const warnings = [
        ...(schemaWarnings ?? []),
        ...qualityWarnings,
        ...qualityNotices,
      ];
      const errors = [
        ...(result.errors?.map((e: any) => ({
          ...e,
          code: e.code || 'VALIDATION_ERROR',
        })) ?? []),
        ...qualityErrors,
      ];
      return {
        file: filePath,
        valid: result.valid && !analysis?.blocked,
        type: 'document',
        ...(errors.length > 0 && { errors }),
        ...(warnings.length > 0 && { warnings }),
      };
    } catch (error: any) {
      // A missing/broken validation module must not silently pass the file.
      return {
        file: filePath,
        valid: false,
        type: 'document',
        errors: [
          {
            path: 'root',
            message: `Validation module unavailable: ${error?.message ?? error}`,
            code: 'validator_error',
          },
        ],
      };
    }
  }

  private async validateAsTheme(
    filePath: string,
    jsonData: any,
    jsonString: string,
    strict?: boolean
  ): Promise<ValidateFileResult> {
    try {
      const { validate, validateStrict } =
        this.format === 'docx'
          ? await import('@json-to-office/shared-docx')
          : await import('@json-to-office/shared-pptx');
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
    } catch (error: any) {
      // A missing/broken validation module must not silently pass the file.
      return {
        file: filePath,
        valid: false,
        type: 'theme',
        errors: [
          {
            path: 'root',
            message: `Validation module unavailable: ${error?.message ?? error}`,
            code: 'validator_error',
          },
        ],
      };
    }
  }

  private async validateWithCustomSchema(
    filePath: string,
    jsonData: any,
    schemaPath: string,
    strict?: boolean
  ): Promise<ValidateFileResult> {
    try {
      const { valid, errors } = await compileAndValidate(
        resolve(schemaPath),
        jsonData,
        strict ?? false
      );

      return {
        file: filePath,
        valid,
        type: 'custom',
        errors: valid
          ? undefined
          : errors.map((error) => ({
              path: error.instancePath || 'root',
              message: error.message || 'Validation error',
              code: error.keyword || 'validation_error',
              value: valueAtPointer(jsonData, error.instancePath),
            })),
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
          return glob(pattern, {
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
      return glob(pathOrPattern, {
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

interface SchemaErrorReport {
  instancePath: string;
  message?: string;
  keyword?: string;
}

/**
 * The value an Ajv error points at, read back from its `instancePath`.
 *
 * Ajv can hand this over itself under `verbose`, but only by embedding the
 * subschema and the failing data at every error site in the validator it
 * generates — which is exactly what this path cannot afford (see below).
 */
function valueAtPointer(data: unknown, pointer: string): unknown {
  if (!pointer) return data;
  let current: unknown = data;
  for (const raw of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined;
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Compile an exported schema and validate one document against it, on a worker
 * thread.
 *
 * The generated schemas are large — the DOCX document schema is several
 * megabytes, most of it one recursive `ComponentDefinition` — and Ajv turns
 * each recursive definition into a single generated function. A stack frame for
 * a function that size, entered once per nesting level of the document, does
 * not fit the ~1MB stack Node gives the main thread: validation threw
 * `RangeError: Maximum call stack size exceeded` before it could report a
 * single schema error, on documents the runtime validator accepts. A worker
 * thread's stack is sized explicitly, so the ceiling is a number here rather
 * than a property of the host.
 *
 * Ajv resolves from this module, not from the worker's cwd: the worker source
 * is evaluated without a filename and could not find `ajv` on its own.
 */
async function compileAndValidate(
  schemaPath: string,
  data: unknown,
  strict: boolean
): Promise<{ valid: boolean; errors: SchemaErrorReport[] }> {
  const { Worker } = await import('node:worker_threads');
  const { default: Module } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const require = Module.createRequire(import.meta.url);

  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(SCHEMA_WORKER_SOURCE, {
      eval: true,
      workerData: {
        ajvUrl: pathToFileURL(require.resolve('ajv')).href,
        formatsUrl: pathToFileURL(require.resolve('ajv-formats')).href,
        schemaPath,
        data,
        strict,
      },
      // 16MB carries the current schemas with room to grow; the default 4MB
      // clears them today by a margin thin enough to break on the next
      // component added.
      resourceLimits: { stackSizeMb: 16 },
    });
    worker.once('message', (message) => {
      void worker.terminate();
      if (message.error) reject(new Error(message.error));
      else resolvePromise({ valid: message.valid, errors: message.errors });
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Schema worker exited with ${code}`));
    });
  });
}

/**
 * CommonJS on purpose: `eval`-ed worker source has no module context of its
 * own, so it reaches Ajv through the file URLs the parent resolved.
 */
const SCHEMA_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { readFileSync } = require('node:fs');

(async () => {
  const ajvModule = await import(workerData.ajvUrl);
  const formatsModule = await import(workerData.formatsUrl);
  const Ajv = ajvModule.default?.default ?? ajvModule.default ?? ajvModule;
  const addFormats =
    formatsModule.default?.default ?? formatsModule.default ?? formatsModule;

  const schema = JSON.parse(readFileSync(workerData.schemaPath, 'utf-8'));
  // Ajv bundles draft-07 under its canonical http URI. Accept the https
  // spelling emitted by older json-to-office schema generators too.
  if (schema.$schema === 'https://json-schema.org/draft-07/schema#') {
    schema.$schema = 'http://json-schema.org/draft-07/schema#';
  }

  const ajv = new Ajv({
    allErrors: true,
    strict: workerData.strict,
    // Renderer profiles make the DOCX schema substantially larger. Keep
    // recursive refs as functions instead of inlining them into one giant
    // validator, which overflows Ajv 8.12's compile stack.
    inlineRefs: false,
  });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(workerData.data);
  parentPort.postMessage({
    valid,
    errors: (validate.errors ?? []).map((error) => ({
      instancePath: error.instancePath,
      message: error.message,
      keyword: error.keyword,
    })),
  });
})().catch((error) => {
  parentPort.postMessage({ error: error?.message ?? String(error) });
});
`;

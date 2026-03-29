/**
 * Global Monaco Editor Configuration
 * Sets up JSON schemas and language defaults for all Monaco instances
 */

import { loader } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import {
  createReportSchemaConfig,
  createThemeSchemaConfig,
} from './json-schema-generator';
import { schemaService } from './schema-service';

let isConfigured = false;
let completionDisposable: { dispose(): void } | null = null;
// Remember last custom theme names so callers that don't pass them
// (e.g. applyPluginsWithValidation) still get them injected.
let lastCustomThemeNames: string[] = [];

export interface MonacoSchemaConfig {
  uri: string;
  fileMatch: string[];
  schema: any;
}

/**
 * Configure Monaco globally with JSON schemas
 * This should be called once when the app initializes
 */
export async function configureMonaco(): Promise<void> {
  if (isConfigured) {
    return;
  }

  try {
    const monaco = await loader.init();
    configureMonacoInstance(monaco);
    isConfigured = true;
    console.log('Monaco configured globally with JSON schemas');
  } catch (error) {
    console.error('Failed to configure Monaco globally:', error);
  }
}

/**
 * Remove trailing commas from JSON string
 * This is a simple regex-based approach that handles most cases
 */
function removeTrailingCommas(jsonStr: string): string {
  // Remove trailing commas before closing brackets/braces
  // This regex finds commas followed by optional whitespace and then ] or }
  return jsonStr.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Configure a Monaco instance with JSON schemas
 */
export function configureMonacoInstance(monaco: Monaco): void {
  // Configure JSON language defaults with enhanced settings
  monaco.languages.json.jsonDefaults.setModeConfiguration({
    documentFormattingEdits: true,
    documentRangeFormattingEdits: true,
    completionItems: false,
    hovers: true,
    documentSymbols: true,
    tokens: true,
    colors: true,
    foldingRanges: true,
    diagnostics: true,
    selectionRanges: true,
  });

  // Register custom document formatting provider to remove trailing commas
  monaco.languages.registerDocumentFormattingEditProvider('json', {
    provideDocumentFormattingEdits(model) {
      const text = model.getValue();

      // First, remove trailing commas
      const cleanedText = removeTrailingCommas(text);

      // Parse and re-stringify to ensure proper formatting
      try {
        const parsed = JSON.parse(cleanedText);
        const formatted = JSON.stringify(parsed, null, 2);

        return [
          {
            range: model.getFullModelRange(),
            text: formatted,
          },
        ];
      } catch (error) {
        // If parsing fails, just return the text with trailing commas removed
        // Monaco's built-in formatter will handle the rest
        return [
          {
            range: model.getFullModelRange(),
            text: cleanedText,
          },
        ];
      }
    },
  });

  // Register custom JSON completion provider that shows schema descriptions inline
  registerJsonCompletionProvider(monaco);

  // Generate schemas for both report and theme files
  const reportSchema = createReportSchemaConfig();
  const themeSchema = createThemeSchemaConfig();

  // Strip non-standard discriminator keyword from static schemas too
  stripDiscriminator(reportSchema.schema);

  // Set up JSON validation with schemas - enhanced for better autocomplete
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    allowComments: false,
    trailingCommas: 'error',
    schemaValidation: 'error', // Strict schema validation
    schemas: [reportSchema, themeSchema],
    schemaRequest: 'ignore', // Ignore unresolvable $schema URIs (domain doesn't exist)
  });

  console.log('Monaco instance configured with schemas:', {
    reportSchema: {
      uri: reportSchema.uri,
      fileMatch: reportSchema.fileMatch,
      schemaKeys: Object.keys(reportSchema.schema),
    },
    themeSchema: {
      uri: themeSchema.uri,
      fileMatch: themeSchema.fileMatch,
      schemaKeys: Object.keys(themeSchema.schema),
    },
  });
}

/**
 * Reset Monaco configuration
 * Useful for testing or when schemas need to be updated
 */
export async function resetMonacoConfig(): Promise<void> {
  isConfigured = false;
  await configureMonaco();
}

/**
 * Recursively strip 'discriminator' keywords from a JSON Schema object.
 * The OpenAPI-style 'discriminator' is not part of JSON Schema Draft-07
 * and may cause unexpected behavior in Monaco's JSON validator.
 */
function stripDiscriminator(obj: any): void {
  if (typeof obj !== 'object' || obj === null) return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => stripDiscriminator(item));
    return;
  }
  delete obj.discriminator;
  for (const value of Object.values(obj)) {
    stripDiscriminator(value);
  }
}

/**
 * Inject custom theme names into the document schema's theme property
 * so Monaco autocomplete suggests them alongside built-in themes.
 */
function injectCustomThemeNames(schema: any, themeNames: string[]): void {
  function inject(themeProp: any): void {
    if (!themeProp || themeProp.type !== 'string') return;
    const existing = Array.isArray(themeProp.examples)
      ? themeProp.examples
      : [];
    themeProp.examples = [...new Set([...existing, ...themeNames])];
  }

  // Direct path (docx schema)
  inject(schema?.properties?.props?.properties?.theme);

  // anyOf branches (pptx schema)
  if (Array.isArray(schema?.anyOf)) {
    for (const branch of schema.anyOf) {
      inject(branch?.properties?.props?.properties?.theme);
    }
  }
}

/**
 * Map LSP CompletionItemKind (1-based) to Monaco CompletionItemKind
 */
function lspToMonacoKind(lspKind: number | undefined, monaco: Monaco): number {
  if (lspKind === undefined) {
    return monaco.languages.CompletionItemKind.Property;
  }
  const map: Record<number, number> = {
    1: monaco.languages.CompletionItemKind.Text,
    2: monaco.languages.CompletionItemKind.Method,
    3: monaco.languages.CompletionItemKind.Function,
    4: monaco.languages.CompletionItemKind.Constructor,
    5: monaco.languages.CompletionItemKind.Field,
    6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class,
    8: monaco.languages.CompletionItemKind.Interface,
    9: monaco.languages.CompletionItemKind.Module,
    10: monaco.languages.CompletionItemKind.Property,
    11: monaco.languages.CompletionItemKind.Unit,
    12: monaco.languages.CompletionItemKind.Value,
    13: monaco.languages.CompletionItemKind.Enum,
    14: monaco.languages.CompletionItemKind.Keyword,
    15: monaco.languages.CompletionItemKind.Snippet,
    16: monaco.languages.CompletionItemKind.Color,
    17: monaco.languages.CompletionItemKind.File,
    18: monaco.languages.CompletionItemKind.Reference,
    19: monaco.languages.CompletionItemKind.Folder,
    20: monaco.languages.CompletionItemKind.EnumMember,
    21: monaco.languages.CompletionItemKind.Constant,
    22: monaco.languages.CompletionItemKind.Struct,
    23: monaco.languages.CompletionItemKind.Event,
    24: monaco.languages.CompletionItemKind.Operator,
    25: monaco.languages.CompletionItemKind.TypeParameter,
  };
  return map[lspKind] ?? monaco.languages.CompletionItemKind.Property;
}

/**
 * Register a custom JSON completion provider that wraps the built-in JSON worker
 * and copies schema `description` into the `detail` field (shown as inline muted text).
 */
function registerJsonCompletionProvider(monaco: Monaco): void {
  if (completionDisposable) {
    completionDisposable.dispose();
    completionDisposable = null;
  }

  completionDisposable = monaco.languages.registerCompletionItemProvider(
    'json',
    {
      triggerCharacters: ['"', ':', ' '],

      async provideCompletionItems(model, position) {
        // Access the JSON worker via the undeclared-but-available getWorker export
        const getWorker = (monaco.languages.json as any).getWorker;
        if (!getWorker) return { suggestions: [] };

        const workerFn = await getWorker();
        const worker = await workerFn(model.uri);

        // doComplete expects LSP Position (0-based line, 0-based character)
        const completionList = await worker.doComplete(model.uri.toString(), {
          line: position.lineNumber - 1,
          character: position.column - 1,
        });

        if (!completionList?.items) {
          return { suggestions: [] };
        }

        const suggestions = completionList.items.map((item: any) => {
          // Extract documentation text for inline detail display
          let detail = '';
          if (item.documentation) {
            if (typeof item.documentation === 'string') {
              detail = item.documentation;
            } else if (item.documentation.value) {
              detail = item.documentation.value;
            }
          }
          if (!detail && item.detail) {
            detail = item.detail;
          }

          // Convert LSP textEdit range (0-based) to Monaco range (1-based)
          let range;
          if (item.textEdit) {
            const r = item.textEdit.range;
            range = {
              startLineNumber: r.start.line + 1,
              startColumn: r.start.character + 1,
              endLineNumber: r.end.line + 1,
              endColumn: r.end.character + 1,
            };
          } else {
            const wordInfo = model.getWordUntilPosition(position);
            range = {
              startLineNumber: position.lineNumber,
              startColumn: wordInfo.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: wordInfo.endColumn,
            };
          }

          const insertText =
            item.textEdit?.newText ??
            item.insertText ??
            (typeof item.label === 'string'
              ? item.label
              : item.label?.label ?? '');

          // Build Monaco documentation from LSP documentation
          let documentation: string | { value: string } | undefined;
          if (item.documentation) {
            if (typeof item.documentation === 'string') {
              documentation = item.documentation;
            } else if (item.documentation.kind === 'markdown') {
              documentation = { value: item.documentation.value };
            } else {
              documentation = item.documentation.value;
            }
          }

          const suggestion: any = {
            label:
              typeof item.label === 'string'
                ? item.label
                : item.label?.label ?? '',
            kind: lspToMonacoKind(item.kind, monaco),
            detail,
            documentation,
            insertText,
            range,
            sortText: item.sortText,
            filterText: item.filterText,
            preselect: item.preselect,
          };

          if (item.insertTextFormat === 2) {
            suggestion.insertTextRules =
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
          }

          return suggestion;
        });

        return { suggestions };
      },
    }
  );
}

/**
 * Update Monaco schemas with plugin-aware document schema
 * @param monaco Monaco instance
 * @param pluginNames Array of plugin names to include in the schema
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function updateMonacoWithPlugins(
  monaco: Monaco,
  pluginNames?: string[],
  customThemeNames?: string[]
): Promise<boolean> {
  try {
    // Clear stale plugin schema cache to ensure fresh data after rebuilds
    schemaService.clearPluginSchemaCache();

    // Fetch the enhanced schema with plugins from the backend.
    // Deep clone so client-side mutations (theme injection, discriminator
    // stripping) don't pollute the cached copy.
    const cachedSchema = await schemaService.fetchDocumentSchema(pluginNames);
    const documentSchema = JSON.parse(JSON.stringify(cachedSchema));

    // Validate that we received a valid schema
    if (!documentSchema || typeof documentSchema !== 'object') {
      throw new Error('Invalid schema received from server');
    }

    // Strip non-standard 'discriminator' keyword from definitions.
    // Monaco's JSON validator (vscode-json-languageservice) may not fully
    // support OpenAPI-style discriminators; standard anyOf validation works
    // correctly without it.
    stripDiscriminator(documentSchema);

    // Update cached theme names when explicitly provided
    if (customThemeNames) {
      lastCustomThemeNames = customThemeNames;
    }

    // Inject custom theme names into the theme property for autocomplete
    if (lastCustomThemeNames.length) {
      injectCustomThemeNames(documentSchema, lastCustomThemeNames);
    }

    // Create the Monaco schema configuration with the SAME URI as the base schema
    const reportSchema: MonacoSchemaConfig = {
      uri: 'https://json-to-office.dev/schema/report/v1.0.0', // Use consistent URI
      fileMatch: ['*.docx.json', '*.pptx.json'],
      schema: documentSchema,
    };

    // Keep the theme schema as is
    const themeSchema = createThemeSchemaConfig();

    // Re-register custom document formatting provider to ensure it's available
    monaco.languages.registerDocumentFormattingEditProvider('json', {
      provideDocumentFormattingEdits(model) {
        const text = model.getValue();

        // First, remove trailing commas
        const cleanedText = removeTrailingCommas(text);

        // Parse and re-stringify to ensure proper formatting
        try {
          const parsed = JSON.parse(cleanedText);
          const formatted = JSON.stringify(parsed, null, 2);

          return [
            {
              range: model.getFullModelRange(),
              text: formatted,
            },
          ];
        } catch (error) {
          // If parsing fails, just return the text with trailing commas removed
          return [
            {
              range: model.getFullModelRange(),
              text: cleanedText,
            },
          ];
        }
      },
    });

    // Update Monaco's JSON defaults with the new schemas
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: false,
      allowComments: false,
      trailingCommas: 'error',
      schemaValidation: 'error',
      schemas: [reportSchema, themeSchema],
      schemaRequest: 'ignore',
    });

    console.log('Monaco updated with plugin-aware schemas:', {
      plugins: pluginNames || [],
      reportSchema: {
        uri: reportSchema.uri,
        fileMatch: reportSchema.fileMatch,
      },
    });

    // Force Monaco to re-validate all open models with the new schema
    const models = monaco.editor.getModels();
    let validationSuccess = true;

    models.forEach((model) => {
      if (model.getLanguageId() === 'json') {
        try {
          // Trigger revalidation by re-setting the language
          monaco.editor.setModelLanguage(model, 'json');
          console.log('🔄 Re-validating model:', model.uri.toString());
        } catch (modelError) {
          console.error(
            'Failed to revalidate model:',
            model.uri.toString(),
            modelError
          );
          validationSuccess = false;
        }
      }
    });

    // Verify that the schema was properly applied
    const diagnosticsOptions =
      monaco.languages.json.jsonDefaults.diagnosticsOptions;
    const hasSchema = diagnosticsOptions.schemas?.some(
      (s: any) => s.uri === reportSchema.uri
    );

    if (!hasSchema) {
      throw new Error('Schema was not properly applied to Monaco editor');
    }

    console.log('✅ Schema validation successful');
    return validationSuccess;
  } catch (error) {
    console.error('Failed to update Monaco with plugin schemas:', error);
    // Fallback to default schemas
    configureMonacoInstance(monaco);
    throw error; // Re-throw to let caller handle the error
  }
}

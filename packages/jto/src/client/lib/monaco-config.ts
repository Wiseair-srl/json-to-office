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
import { registerFontCodeLens } from './monaco-fonts-codelens';
import { registerMonacoThemes } from './monaco-theme';
import {
  applyDocumentBlocksToSchema,
  unionBranches,
  type DocumentBlockTarget,
} from '@json-to-office/shared';
import { preparePptxDocumentBlockTargets } from '@json-to-office/shared-pptx';
import { docxDocumentBlockTargets } from '@json-to-office/shared-docx';
import { createQualityPolicySchemaConfig } from './quality-policy-schema';
import type { BrowserComponentSchemaInfo } from '../store/browser-plugins-store';
import { useEditorRefsStore } from '../store/editor-refs-store';
import { FORMAT } from './env';
import { loadBlockReferences } from './block-references';
import { blockSnippets } from './block-snippets';
import {
  blockDefinitionsSignature,
  readDocumentBlockDefinitions,
  type DocumentBlockDefinitions,
} from './document-blocks';

let isConfigured = false;
let completionDisposable: { dispose(): void } | null = null;
// Remember last custom theme names so callers that don't pass them
// (e.g. applyPluginsWithValidation) still get them injected.
let lastCustomThemeNames: string[] = [];
// Same for the browser plugins: a caller refreshing for a disk-plugin toggle
// must not drop the components compiled in the page.
let lastBrowserComponents: BrowserComponentSchemaInfo[] = [];
// Refreshes overlap constantly — every plugin that finishes compiling asks for
// its own schema, and a page with four of them loads with four requests in
// flight at once. The responses are megabytes each and come back in whatever
// order the server and the network settle on, so without this counter the last
// response to *arrive* wins rather than the newest one, and Monaco is regularly
// left validating against a schema built before the newest plugin existed: its
// component reads as an unknown `name` until something else forces a refresh.
let schemaGeneration = 0;
// The document schema as fetched (or the static fallback), never mutated:
// what Monaco actually validates against is a copy of it with the custom
// theme names and the active document's block definitions applied.
let baseDocumentSchema: any = null;
// The block definitions of the document being edited. They are part of the
// schema — `ref` completes them, their slots complete and validate — so the
// schema is reinstalled whenever they change (see updateMonacoDocumentBlocks).
let lastDocumentBlocks: DocumentBlockDefinitions = {};
let lastDocumentBlocksSignature = blockDefinitionsSignature({});

const DOCUMENT_SCHEMA_URI = 'https://json-to-office.dev/schema/report/v1.0.0';

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
  // Paint the editor chrome from the design tokens (idempotent).
  registerMonacoThemes(monaco);

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

  // The reference block catalog the provider offers: asked for now so the
  // first completion does not go without it.
  void loadBlockReferences();

  // Register CodeLens provider that puts a "Pick font…" action above any
  // font-name string in the active JSON doc.
  registerFontCodeLens(monaco);

  // The static schema until the plugin-aware one arrives from the server.
  const reportSchema = createReportSchemaConfig();
  stripDiscriminator(reportSchema.schema);
  baseDocumentSchema = reportSchema.schema;
  installDocumentSchema(monaco);

  console.log('Monaco instance configured with schemas:', {
    reportSchema: {
      uri: DOCUMENT_SCHEMA_URI,
      fileMatch: reportSchema.fileMatch,
      schemaKeys: Object.keys(reportSchema.schema),
    },
  });
}

/** Where a document's own block definitions apply in the running format. */
function documentBlockTargets(schema: any): DocumentBlockTarget[] {
  return FORMAT === 'pptx'
    ? preparePptxDocumentBlockTargets(schema)
    : docxDocumentBlockTargets(schema);
}

/**
 * Install the document schema Monaco validates against: the base schema with
 * the custom theme names and the active document's block definitions
 * applied. Called whenever any of the three changes.
 */
function installDocumentSchema(monaco: Monaco): void {
  if (!baseDocumentSchema) return;
  const schema = JSON.parse(JSON.stringify(baseDocumentSchema));
  if (lastCustomThemeNames.length) {
    injectCustomThemeNames(schema, lastCustomThemeNames);
  }
  applyDocumentBlocksToSchema(
    schema,
    lastDocumentBlocks,
    documentBlockTargets(schema)
  );
  const reportSchema: MonacoSchemaConfig = {
    uri: DOCUMENT_SCHEMA_URI,
    fileMatch: ['*.docx.json', '*.pptx.json'],
    schema,
  };
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    allowComments: false,
    trailingCommas: 'error',
    schemaValidation: 'error', // Strict schema validation
    schemas: [
      reportSchema,
      createThemeSchemaConfig(),
      createQualityPolicySchemaConfig(),
    ],
    schemaRequest: 'ignore', // Ignore unresolvable $schema URIs (domain doesn't exist)
  });
}

/**
 * Tell Monaco which blocks the document being edited defines. Cheap when
 * nothing changed — the common case on a keystroke inside a slide — and a
 * schema reinstall when a definition was added, removed or edited, so the
 * editor completes and validates invocations against what the document says
 * now. Returns whether the schema was reinstalled.
 */
export function updateMonacoDocumentBlocks(
  monaco: Monaco,
  definitions: DocumentBlockDefinitions
): boolean {
  const signature = blockDefinitionsSignature(definitions);
  if (signature === lastDocumentBlocksSignature) return false;
  lastDocumentBlocks = definitions;
  lastDocumentBlocksSignature = signature;
  installDocumentSchema(monaco);
  return true;
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

  // Union branches — flat anyOf or restructured if/then dispatch. The PPTX
  // root dispatches on `renderer` to one referenced definition per profile,
  // each of which is itself a union carrying the root component.
  const deref = (node: any): any =>
    typeof node?.$ref === 'string'
      ? schema?.definitions?.[node.$ref.replace('#/definitions/', '')]
      : node;
  for (const branch of unionBranches(schema)) {
    const resolved = deref(branch);
    inject(resolved?.properties?.props?.properties?.theme);
    for (const inner of unionBranches(resolved)) {
      inject((inner as any)?.properties?.props?.properties?.theme);
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

        const suggestions = (completionList?.items ?? []).map((item: any) => {
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

        // Block snippets: reference blocks the document does not define yet,
        // inserted with their definitions, and whole invocations wherever a
        // slide or section takes content. Offsets from the pure module map
        // onto model positions here.
        const text = model.getValue();
        // Long strings sit in the model as collapse sentinels; definitions
        // and the example an invocation provides are read from the expanded
        // document, while offsets and edits stay in model text.
        const expanded =
          useEditorRefsStore
            .getState()
            .getEditorForModel(model)
            ?.toStorageValue(text) ?? text;
        let document: unknown;
        try {
          document = JSON.parse(expanded);
        } catch {
          document = undefined;
        }
        const toRange = (span: { offset: number; length: number }) => {
          const start = model.getPositionAt(span.offset);
          const end = model.getPositionAt(span.offset + span.length);
          return {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
        };
        for (const snippet of blockSnippets(text, model.getOffsetAt(position), {
          references: await loadBlockReferences(),
          definitions: readDocumentBlockDefinitions(expanded),
          format: FORMAT,
          document,
        })) {
          suggestions.push({
            label: snippet.label,
            kind:
              snippet.kind === 'ref'
                ? monaco.languages.CompletionItemKind.Value
                : monaco.languages.CompletionItemKind.Snippet,
            detail: snippet.detail,
            documentation: snippet.documentation
              ? { value: snippet.documentation }
              : undefined,
            insertText: snippet.insertText,
            filterText: snippet.filterText,
            insertTextRules:
              snippet.kind === 'component'
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            range: toRange(snippet.replace),
            additionalTextEdits: snippet.additionalEdits.map((edit) => ({
              range: toRange(edit),
              text: edit.content,
            })),
            // Ahead of the worker's items: a block is the answer to "what
            // goes on this slide" more often than a bare text box.
            sortText: `0 ${snippet.label}`,
          });
        }

        return { suggestions };
      },
    }
  );
}

/**
 * Update Monaco schemas with plugin-aware document schema
 * @param monaco Monaco instance
 * @param pluginNames Array of plugin names to include in the schema
 * @param customThemeNames Custom theme names to offer for `props.theme`
 * @param browserComponents Components compiled in the browser; omitted means
 *   "keep the last set", so a refresh for another reason does not drop them
 * @returns Promise that resolves to true if successful, false otherwise
 */
export async function updateMonacoWithPlugins(
  monaco: Monaco,
  pluginNames?: string[],
  customThemeNames?: string[],
  browserComponents?: BrowserComponentSchemaInfo[]
): Promise<boolean> {
  const generation = ++schemaGeneration;
  try {
    if (browserComponents) {
      lastBrowserComponents = browserComponents;
    }

    // Fetch the enhanced schema with plugins from the backend.
    // Deep clone so client-side mutations (theme injection, discriminator
    // stripping) don't pollute the cached copy.
    // Never a stored answer: the cache key cannot see a plugin rebuilt on disk
    // under an unchanged name. `bypassCache` skips the store without declaring
    // anything stale, so the several refreshes that land in the same tick on
    // load still share one request instead of sending the same megabytes twice.
    const cachedSchema = await schemaService.fetchDocumentSchema(
      pluginNames,
      lastBrowserComponents,
      { bypassCache: true }
    );
    // A newer refresh started while this one was in flight. Its request was
    // built from a later view of the plugins, so installing this older schema
    // would undo it. Report success: the call that superseded this one owns
    // the outcome, and a `false` here would surface as a failed apply.
    if (generation !== schemaGeneration) {
      return true;
    }

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

    // Install it, with the custom theme names and the active document's
    // block definitions applied on top.
    baseDocumentSchema = documentSchema;
    installDocumentSchema(monaco);

    console.log('Monaco updated with plugin-aware schemas:', {
      plugins: pluginNames || [],
      browserPlugins: lastBrowserComponents.map((c) => c.name),
      blocks: Object.keys(lastDocumentBlocks),
      reportSchema: { uri: DOCUMENT_SCHEMA_URI },
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
      (s: any) => s.uri === DOCUMENT_SCHEMA_URI
    );

    if (!hasSchema) {
      throw new Error('Schema was not properly applied to Monaco editor');
    }

    console.log('✅ Schema validation successful');
    return validationSuccess;
  } catch (error) {
    console.error('Failed to update Monaco with plugin schemas:', error);
    // Same rule as the success path: a failed refresh must not roll a newer
    // one back to the plugin-free defaults.
    if (generation === schemaGeneration) {
      // Fallback to default schemas
      configureMonacoInstance(monaco);
    }
    throw error; // Re-throw to let caller handle the error
  }
}

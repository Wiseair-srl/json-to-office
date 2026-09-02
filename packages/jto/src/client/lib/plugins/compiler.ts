import { loader } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditorType } from 'monaco-editor';
import { ensurePluginTypeScript } from './type-libs';
import { hashSource } from './hash';
import type { PluginDiagnostic } from './types';

/**
 * Compile a plugin source with Monaco's TypeScript worker.
 *
 * Headless: the compiler owns one text model per plugin file, at the same
 * URI the editor tab opens, so the two share it — a compile started by the
 * sync hook and the diagnostics the editor shows come from one program.
 * When the model is on screen its live text wins over the store snapshot,
 * which trails the editor by the save debounce.
 */

export interface CompileResult {
  /** The text that was compiled (the live model text, which may be newer than the store). */
  source: string;
  /** Emitted CommonJS, or null when the source has errors. */
  js: string | null;
  diagnostics: PluginDiagnostic[];
  /** True when the live text matched `skipIfHash` and nothing was compiled. */
  skipped: boolean;
}

const MODEL_SCHEME_PATH = 'file:///plugins/';

/** The model URI for a plugin file; the editor tab must use the same path. */
export function pluginModelPath(docName: string): string {
  return `${MODEL_SCHEME_PATH}${encodeURIComponent(docName)}`;
}

function isAttachedToEditor(
  monaco: Monaco,
  model: MonacoEditorType.ITextModel
): boolean {
  return monaco.editor.getEditors().some((e) => e.getModel() === model);
}

interface WorkerDiagnostic {
  start?: number;
  length?: number;
  messageText: string | { messageText: string; next?: unknown[] };
  category: number;
  code: number;
}

function flattenMessage(text: WorkerDiagnostic['messageText']): string {
  if (typeof text === 'string') return text;
  const parts: string[] = [text.messageText];
  const queue = Array.isArray(text.next) ? [...text.next] : [];
  while (queue.length > 0) {
    const next = queue.shift() as WorkerDiagnostic['messageText'] | undefined;
    if (!next) continue;
    if (typeof next === 'string') parts.push(next);
    else {
      parts.push(next.messageText);
      if (Array.isArray(next.next)) queue.push(...next.next);
    }
  }
  return parts.join(' ');
}

function toDiagnostic(
  diagnostic: WorkerDiagnostic,
  model: MonacoEditorType.ITextModel
): PluginDiagnostic {
  // TypeScript's DiagnosticCategory: Warning = 0, Error = 1, Suggestion = 2, Message = 3.
  const severity: PluginDiagnostic['severity'] =
    diagnostic.category === 1
      ? 'error'
      : diagnostic.category === 0
        ? 'warning'
        : 'info';
  const result: PluginDiagnostic = {
    severity,
    message: `${flattenMessage(diagnostic.messageText)} (TS${diagnostic.code})`,
    source: 'typescript',
  };
  if (typeof diagnostic.start === 'number') {
    const start = model.getPositionAt(diagnostic.start);
    const end = model.getPositionAt(
      diagnostic.start + (diagnostic.length ?? 0)
    );
    result.line = start.lineNumber;
    result.column = start.column;
    result.endLine = end.lineNumber;
    result.endColumn = end.column;
  }
  return result;
}

export async function compilePlugin(
  docName: string,
  source: string,
  skipIfHash?: string
): Promise<CompileResult> {
  const monaco = await loader.init();
  await ensurePluginTypeScript(monaco);

  const uri = monaco.Uri.parse(pluginModelPath(docName));
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(source, 'typescript', uri);
  } else if (
    model.getValue() !== source &&
    !isAttachedToEditor(monaco, model)
  ) {
    model.setValue(source);
  }
  const text = model.getValue();

  // The store trails an open editor by its save debounce, so a sync started
  // from the store can find that the live text is the one it already
  // compiled. Say so instead of compiling it a second time.
  if (skipIfHash !== undefined && hashSource(text) === skipIfHash) {
    return { source: text, js: null, diagnostics: [], skipped: true };
  }

  const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
  const client = await getWorker(uri);
  const fileName = uri.toString();
  const [syntactic, semantic, emit] = await Promise.all([
    client.getSyntacticDiagnostics(fileName),
    client.getSemanticDiagnostics(fileName),
    client.getEmitOutput(fileName),
  ]);

  const diagnostics = [
    ...(syntactic as unknown as WorkerDiagnostic[]),
    ...(semantic as unknown as WorkerDiagnostic[]),
  ]
    .map((d) => toDiagnostic(d, model!))
    .filter((d) => d.severity !== 'info');
  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  const js =
    emit.outputFiles.find((file) => file.name.endsWith('.js'))?.text ?? null;

  return {
    source: text,
    js: hasErrors ? null : js,
    diagnostics,
    skipped: false,
  };
}

/** Drop the headless model once its file is gone, unless an editor still shows it. */
export function disposePluginModel(docName: string): void {
  const monaco = loader.__getMonacoInstance();
  if (!monaco) return;
  const model = monaco.editor.getModel(
    monaco.Uri.parse(pluginModelPath(docName))
  );
  if (model && !isAttachedToEditor(monaco, model)) model.dispose();
}

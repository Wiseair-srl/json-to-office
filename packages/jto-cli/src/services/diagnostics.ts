import { AsyncLocalStorage } from 'node:async_hooks';

export type DiagnosticTone =
  | 'default'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted';

export type DiagnosticSink = (text: string, tone?: DiagnosticTone) => void;

const sinks = new AsyncLocalStorage<DiagnosticSink>();

/** Route service diagnostics into the active Ink task without global output. */
export function runWithDiagnosticSink<T>(
  sink: DiagnosticSink,
  callback: () => T
): T {
  return sinks.run(sink, callback);
}

/** Libraries stay quiet by default; CLI tasks install a scoped Ink sink. */
export function emitDiagnostic(
  text: string,
  tone: DiagnosticTone = 'muted'
): void {
  sinks.getStore()?.(text, tone);
}

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

/**
 * Scope a sink to one operation. The CLI installs an Ink-backed one per
 * task; the MCP server installs one that collects into its response.
 */
export function runWithDiagnosticSink<T>(
  sink: DiagnosticSink,
  callback: () => T
): T {
  return sinks.run(sink, callback);
}

/**
 * This package writes to no stream of its own — a host may own stdout as a
 * protocol channel — so with no sink installed the message is dropped.
 */
export function emitDiagnostic(
  text: string,
  tone: DiagnosticTone = 'muted'
): void {
  sinks.getStore()?.(text, tone);
}

/**
 * Plain-text sink for hosts with no UI of their own. stderr, not stdout,
 * so it stays safe to install alongside a stdout protocol stream.
 */
export const stderrDiagnosticSink: DiagnosticSink = (text) => {
  process.stderr.write(`${text}\n`);
};

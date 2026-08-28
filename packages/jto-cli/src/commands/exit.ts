/**
 * Exiting without losing buffered output.
 *
 * `process.exit()` terminates immediately. When stdout is a pipe its writes are
 * asynchronous, so anything still queued at that moment is discarded — a
 * command that prints a large JSON payload and exits in the same tick emits
 * exactly one pipe buffer (64 KB on Linux and macOS) of valid JSON followed by
 * nothing. Redirecting to a file hides the bug, because writes to a regular
 * file are synchronous and the queue is always empty by the time exit runs.
 *
 * Every command that terminates the process deliberately must go through
 * `exitAfterFlush` rather than `process.exit`, so the size of the output never
 * decides whether it survives.
 */

/** Resolves once the stream has drained everything already queued. */
export function flush(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableEnded || stream.writableLength === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}

/** Terminates with `code` once stdout and stderr have drained. */
export async function exitAfterFlush(code: number): Promise<never> {
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}

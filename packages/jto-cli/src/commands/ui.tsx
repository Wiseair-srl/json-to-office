import { basename, dirname, relative } from 'node:path';
import { createElement, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Box, Static, Text, render, useApp, useInput } from 'ink';
import chalk from 'chalk';
import { runWithDiagnosticSink } from '@json-to-office/jto-ops';

export const EXIT_CODES = { OK: 0, FAIL: 1 } as const;

export type UiTone =
  | 'default'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted';

export interface UiLine {
  text: string;
  tone?: UiTone;
}

export interface TaskReporter {
  update(message: string): void;
  log(message: string, tone?: UiTone): void;
}

interface TaskOutcome<T> {
  value?: T;
  error?: unknown;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Ink-native transient status indicator. */
export function Spinner(): ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % SPINNER_FRAMES.length),
      80
    );
    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
}

function toneProps(tone: UiTone | undefined): {
  color?: string;
  dimColor?: boolean;
} {
  switch (tone) {
    case 'info':
      return { color: 'cyan' };
    case 'success':
      return { color: 'green' };
    case 'warning':
      return { color: 'yellow' };
    case 'error':
      return { color: 'red' };
    case 'muted':
      return { dimColor: true };
    default:
      return {};
  }
}

function OutputLine({ line }: { line: UiLine }): ReactElement {
  return <Text {...toneProps(line.tone)}>{line.text}</Text>;
}

/** Permanent command output. Static keeps completed lines out of live redraws. */
export function StaticOutput({ lines }: { lines: UiLine[] }): ReactElement {
  return (
    <Box flexDirection="column">
      <Static items={lines}>
        {(line, index) => (
          <OutputLine key={`${index}:${line.text}`} line={line} />
        )}
      </Static>
    </Box>
  );
}

interface TaskViewProps<T> {
  initial: string;
  success: string | ((value: T) => string);
  failure: string;
  task: (reporter: TaskReporter) => Promise<T>;
  complete: (outcome: TaskOutcome<T>) => void;
}

function TextPrompt({
  label,
  initial,
  complete,
}: {
  label: string;
  initial: string;
  complete: (value: string) => void;
}): ReactElement {
  const { exit } = useApp();
  const [value, setValue] = useState(initial);
  const [pristine, setPristine] = useState(true);

  useInput((input, key) => {
    if (key.return) {
      complete(value.trim());
      exit();
      return;
    }
    if (key.escape || (key.ctrl && input === 'c')) {
      complete('');
      exit();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => (pristine ? '' : current.slice(0, -1)));
      setPristine(false);
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setValue((current) => (pristine ? input : current + input));
      setPristine(false);
    }
  });

  return (
    <Box>
      <Text color="cyan">{label}</Text>
      <Text dimColor={pristine}> {value}</Text>
      <Text inverse> </Text>
    </Box>
  );
}

function TaskView<T>({
  initial,
  success,
  failure,
  task,
  complete,
}: TaskViewProps<T>): ReactElement {
  const { exit } = useApp();
  const [message, setMessage] = useState(initial);
  const [logs, setLogs] = useState<UiLine[]>([]);
  const [outcome, setOutcome] = useState<TaskOutcome<T> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const reporter: TaskReporter = {
      update: setMessage,
      log: (text, tone = 'default') =>
        setLogs((current) => [...current, { text, tone }]),
    };

    void runWithDiagnosticSink(
      (text, tone) => reporter.log(text, tone),
      () => task(reporter)
    ).then(
      (value) => {
        setMessage(typeof success === 'function' ? success(value) : success);
        setOutcome({ value });
      },
      (error) => {
        setMessage(failure);
        setOutcome({ error });
      }
    );
  }, [failure, success, task]);

  useEffect(() => {
    if (!outcome) return;
    complete(outcome);
    exit();
  }, [complete, exit, outcome]);

  return (
    <Box flexDirection="column">
      <Static items={logs}>
        {(line, index) => (
          <OutputLine key={`${index}:${line.text}`} line={line} />
        )}
      </Static>
      <Box>
        {outcome ? (
          <Text color={outcome.error ? 'red' : 'green'}>
            {outcome.error ? '✗' : '✓'}
          </Text>
        ) : (
          <Spinner />
        )}
        <Text> {message}</Text>
      </Box>
    </Box>
  );
}

export async function runTask<T>(
  initial: string,
  task: (reporter: TaskReporter) => Promise<T>,
  options: {
    success?: string | ((value: T) => string);
    failure?: string;
    stdout?: NodeJS.WriteStream;
  } = {}
): Promise<T> {
  const success = options.success ?? 'Done';
  const failure = options.failure ?? 'Failed';
  const stdout = options.stdout ?? process.stdout;

  // Without a TTY there is nothing to animate, and Ink's redraw would leak
  // escape sequences into the pipe. Run the task bare and report plainly.
  if (!stdout.isTTY) {
    const logs: UiLine[] = [];
    const record = (text: string, tone: UiTone = 'default') =>
      logs.push({ text, tone });
    try {
      const value = await runWithDiagnosticSink(record, () =>
        task({ update: () => {}, log: record })
      );
      record(`✓ ${typeof success === 'function' ? success(value) : success}`);
      writePlain(stdout, logs);
      return value;
    } catch (error) {
      record(`✗ ${failure}`);
      writePlain(stdout, logs);
      throw error;
    }
  }

  let settle!: (outcome: TaskOutcome<T>) => void;
  const completed = new Promise<TaskOutcome<T>>((resolve) => {
    settle = resolve;
  });
  const component = createElement(TaskView<T>, {
    initial,
    task,
    success,
    failure,
    complete: settle,
  });
  const app = render(component, { stdout, patchConsole: false });
  const exited = app.waitUntilExit();
  const outcome = await completed;
  await exited.catch(() => undefined);
  app.cleanup();
  if (outcome.error) throw outcome.error;
  return outcome.value as T;
}

/**
 * Ink drives a live, width-aware TUI: it emits cursor-control sequences and
 * hard-wraps text at the terminal width. Both are wrong for a pipe or a file —
 * wrapping injects real newlines into long paths, breaking anything that parses
 * our output. When the target stream is not a TTY, write the lines plainly.
 */
function writePlain(stream: NodeJS.WriteStream, lines: UiLine[]): void {
  stream.write(`${lines.map((line) => line.text).join('\n')}\n`);
}

export async function renderLines(
  lines: UiLine[],
  stdout: NodeJS.WriteStream = process.stdout
): Promise<void> {
  if (lines.length === 0) return;
  const normalized = lines.flatMap((line) =>
    line.text.split('\n').map((text) => ({ ...line, text }))
  );
  if (!stdout.isTTY) {
    writePlain(stdout, normalized);
    return;
  }
  const app = render(createElement(StaticOutput, { lines: normalized }), {
    stdout,
  });
  const exited = app.waitUntilExit();
  app.unmount();
  try {
    await exited;
  } finally {
    app.cleanup();
  }
}

export async function promptText(
  label: string,
  initial: string
): Promise<string> {
  if (!process.stdin.isTTY) return initial;
  let settle!: (value: string) => void;
  const completed = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const app = render(
    createElement(TextPrompt, { label, initial, complete: settle }),
    { exitOnCtrlC: false }
  );
  const exited = app.waitUntilExit();
  const value = await completed;
  await exited;
  app.cleanup();
  return value;
}

/** Machine-readable output intentionally bypasses Ink. */
export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function shortPath(absPath: string): string {
  return relative(process.cwd(), absPath) || absPath;
}

export function dimPath(absPath: string): string {
  const rel = shortPath(absPath);
  const dir = dirname(rel);
  const file = basename(rel);
  return dir === '.'
    ? chalk.bold(file)
    : chalk.dim(`${dir}/`) + chalk.bold(file);
}

/** Dependency-free table formatter; Ink handles final rendering. */
export function createTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => stripAnsi(row[index] ?? '').length)
    )
  );
  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => {
        const visible = stripAnsi(cell ?? '').length;
        return `${cell ?? ''}${' '.repeat(Math.max(0, widths[index] - visible))}`;
      })
      .join('  ')
      .trimEnd();
  return [
    formatRow(headers.map((header) => chalk.bold(header))),
    widths.map((width) => '─'.repeat(width)).join('  '),
    ...rows.map(formatRow),
  ].join('\n');
}

function stripAnsi(value: string): string {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  return value.replace(ansiPattern, '');
}

export function elapsed(startMs: number): string {
  return `${Math.round(performance.now() - startMs)}ms`;
}

export function formatTiming(startMs: number): string {
  return chalk.dim(`(${elapsed(startMs)})`);
}

export function errorLines(error: any): UiLine[] {
  if (error?.code === 'ENOENT') {
    return [
      {
        text: `File not found: ${error.path || error.message}`,
        tone: 'error',
      },
    ];
  }
  if (error instanceof SyntaxError) {
    return [
      { text: 'Invalid JSON in input file', tone: 'error' },
      { text: error.message, tone: 'muted' },
    ];
  }

  const lines: UiLine[] = [
    { text: error?.message || String(error), tone: 'error' },
  ];
  if (error?.validationErrors) {
    lines.push({ text: 'Validation errors:', tone: 'warning' });
    for (const validationError of error.validationErrors) {
      lines.push({
        text: `  - ${validationError.path || 'root'}: ${validationError.message}`,
        tone: 'error',
      });
      for (const suggestion of validationError.suggestions ?? []) {
        lines.push({ text: `    -> ${suggestion}`, tone: 'muted' });
      }
    }
  } else if (error?.stack) {
    lines.push({ text: 'Stack trace:', tone: 'muted' });
    lines.push({ text: error.stack, tone: 'muted' });
  }
  return lines;
}

/** Failures belong on stderr so `cmd > out.json` keeps data and errors apart. */
export async function formatError(error: unknown): Promise<void> {
  await renderLines(errorLines(error), process.stderr);
}

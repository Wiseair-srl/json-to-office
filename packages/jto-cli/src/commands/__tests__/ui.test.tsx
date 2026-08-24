import { describe, expect, it } from 'vitest';
import { renderToString } from 'ink';
import { PassThrough } from 'node:stream';
import {
  StaticOutput,
  createTable,
  errorLines,
  promptText,
  runTask,
  type UiLine,
} from '../ui.js';
import { emitDiagnostic } from '@json-to-office/jto-ops';

describe('Ink CLI UI', () => {
  it('renders permanent output with Ink', () => {
    const lines: UiLine[] = [
      { text: 'Generated report.docx', tone: 'success' },
      { text: '12ms', tone: 'muted' },
    ];

    const output = renderToString(<StaticOutput lines={lines} />);

    expect(output).toContain('Generated report.docx');
    expect(output).toContain('12ms');
  });

  it('formats tables without legacy table dependencies', () => {
    const output = createTable(
      ['File', 'Status'],
      [
        ['one.json', 'OK'],
        ['long-name.json', 'FAIL'],
      ]
    );

    expect(output).toContain('long-name.json  FAIL');
    expect(output).toContain('─');
  });

  it('turns validation failures into reusable UI lines', () => {
    const lines = errorLines({
      message: 'Invalid document',
      validationErrors: [
        {
          path: '/children/0',
          message: 'Unknown component',
          suggestions: ['Use text'],
        },
      ],
    });

    expect(lines.map((line) => line.text)).toEqual(
      expect.arrayContaining([
        'Invalid document',
        '  - /children/0: Unknown component',
        '    -> Use text',
      ])
    );
  });

  it('propagates task failures after Ink exits', async () => {
    const output = new PassThrough() as unknown as NodeJS.WriteStream;

    await expect(
      runTask(
        'Working...',
        async () => {
          throw new Error('boom');
        },
        { failure: 'Failed', stdout: output }
      )
    ).rejects.toThrow('boom');
  });

  it('routes service diagnostics through the active Ink task', async () => {
    const stream = new PassThrough();
    const output: Buffer[] = [];
    stream.on('data', (chunk) => output.push(Buffer.from(chunk)));

    await runTask(
      'Working...',
      async () => {
        emitDiagnostic('Plugin warning', 'warning');
      },
      { stdout: stream as unknown as NodeJS.WriteStream }
    );

    expect(Buffer.concat(output).toString('utf8')).toContain('Plugin warning');
  });

  it('uses prompt default in non-interactive environments', async () => {
    await expect(promptText('Project:', 'my-project')).resolves.toBe(
      'my-project'
    );
  });
});

import { describe, expect, it } from 'vitest';
import { parseArgs, serverCommand } from './cli.js';
import { analyzeDocument, structuralPages } from './analyze.js';

describe('parseArgs', () => {
  it('defaults to the committed development corpus, cold', () => {
    const options = parseArgs([]);
    expect(options.corpusDir).toMatch(/briefs$/);
    expect(options.sealed).toBe(false);
    expect(options.mode).toBe('cold');
    expect(options.briefs).toBeUndefined();
  });

  it('takes a brief selector, a model and an output directory', () => {
    const options = parseArgs([
      '--briefs',
      'a,b,c',
      '--model',
      'claude-opus-5',
      '--out',
      '/tmp/run',
      '--max-turns',
      '12',
    ]);
    expect(options).toMatchObject({
      briefs: 'a,b,c',
      model: 'claude-opus-5',
      outDir: '/tmp/run',
      maxTurns: 12,
    });
  });

  it('marks a supplied acceptance corpus sealed by the flag that names it', () => {
    // Sealing is not something a caller opts into separately and can forget:
    // pointing at an acceptance corpus IS the opt-in.
    const options = parseArgs(['--sealed-corpus', '/elsewhere/briefs']);
    expect(options).toMatchObject({
      corpusDir: '/elsewhere/briefs',
      sealed: true,
    });
  });

  it('scores hard metrics only until a judge is asked for', () => {
    // The countable half needs no model and no money; the opinion is opt-in.
    expect(parseArgs([]).judgeModel).toBeUndefined();
    expect(parseArgs(['--judge']).judgeModel).toBe('claude-opus-5');
    expect(parseArgs(['--judge', 'claude-sonnet-5']).judgeModel).toBe(
      'claude-sonnet-5'
    );
  });

  it('runs each brief once unless asked to repeat', () => {
    // Three runs per brief at final acceptance is how run variance becomes
    // visible rather than being averaged into the result.
    expect(parseArgs([]).repeat).toBe(1);
    expect(parseArgs(['--repeat', '3']).repeat).toBe(3);
    expect(parseArgs(['--repeat', '0']).repeat).toBe(1);
  });

  it('becomes an assisted run only when a skill is supplied', () => {
    expect(parseArgs([]).mode).toBe('cold');
    expect(parseArgs(['--skill', '/tmp/SKILL.md'])).toMatchObject({
      mode: 'assisted',
      skillPath: '/tmp/SKILL.md',
    });
  });
});

describe('serverCommand', () => {
  it('tells the server the workspace directory the harness will read', () => {
    // The bug this pins cost two good runs. The harness makes a workspace
    // directory, reads the agent's final document out of it, and used to copy
    // JTO_WORKSPACE_DIR from its own environment — where it is normally unset.
    // The server then kept workspaces in memory, the harness found nothing on
    // disk, and every agent that authored through a handle (which is what the
    // server's own instructions tell it to do) was scored as having generated
    // nothing at all.
    const command = serverCommand('/repo', '/tmp/ws-root');
    expect(command.env?.JTO_WORKSPACE_DIR).toBe('/tmp/ws-root');
    expect(command.args[0]).toContain('mcp-server');
  });

  it("does not let an ambient JTO_WORKSPACE_DIR win over the run's own", () => {
    const previous = process.env.JTO_WORKSPACE_DIR;
    process.env.JTO_WORKSPACE_DIR = '/somewhere/else';
    try {
      expect(
        serverCommand('/repo', '/tmp/ws-root').env?.JTO_WORKSPACE_DIR
      ).toBe('/tmp/ws-root');
    } finally {
      if (previous === undefined) delete process.env.JTO_WORKSPACE_DIR;
      else process.env.JTO_WORKSPACE_DIR = previous;
    }
  });
});

describe('structuralPages', () => {
  it('counts enabled slides in a deck', () => {
    expect(
      structuralPages('pptx', {
        children: [
          { name: 'slide' },
          { name: 'slide', enabled: false },
          { name: 'slide' },
        ],
      })
    ).toBe(2);
  });

  it('counts sections in a document, and never zero for a document with content', () => {
    expect(
      structuralPages('docx', {
        children: [{ name: 'section' }, { name: 'section' }],
      })
    ).toBe(2);
    expect(structuralPages('docx', { children: [{ name: 'paragraph' }] })).toBe(
      1
    );
    expect(structuralPages('docx', { children: [] })).toBe(0);
  });
});

describe('analyzeDocument', () => {
  it('measures the document itself rather than trusting a report about it', async () => {
    const measured = await analyzeDocument('pptx', {
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'Lorem ipsum dolor sit amet.' } },
          ],
        },
      ],
    });
    const codes = measured.diagnostics.map(
      (entry) => (entry as { code?: string }).code
    );
    // The undeclared canvas and the leftover filler are both real findings on
    // this document, and both come from the shipped rules, not from here.
    expect(codes).toContain('W_QUALITY_CANVAS_UNSPECIFIED');
    expect(codes).toContain('W_QUALITY_PLACEHOLDER_TEXT');
    expect(measured.pages).toBe(1);
  });

  it('reports a document that does not validate as blocking', async () => {
    const measured = await analyzeDocument('docx', { name: 'docx' });
    expect(
      measured.diagnostics.some(
        (entry) => (entry as { severity?: string }).severity === 'error'
      )
    ).toBe(true);
  });
});

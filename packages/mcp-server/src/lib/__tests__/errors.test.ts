import { describe, it, expect } from 'vitest';
import { emitDiagnostic } from '@json-to-office/jto-ops';

import {
  ERROR_CODES,
  diagnostic,
  failure,
  fromValidationError,
  fromValidationErrors,
  guarded,
  normalizeCode,
  success,
  toolResult,
  validationDiagnostics,
  normalizeWarningCode,
} from '../errors.js';

describe('diagnostics', () => {
  it('defaults severity to error', () => {
    expect(diagnostic('E_X', 'boom')).toEqual({
      severity: 'error',
      code: 'E_X',
      message: 'boom',
    });
  });

  it('carries a JSON Pointer and a suggestion when given', () => {
    expect(
      diagnostic('E_X', 'boom', {
        severity: 'warning',
        path: '/content/2/text',
        suggestion: 'shorten it',
      })
    ).toMatchObject({
      severity: 'warning',
      path: '/content/2/text',
      suggestion: 'shorten it',
    });
  });

  it('gives a codeless ValidationError a code to switch on', () => {
    expect(
      fromValidationError({ path: '/content/0', message: 'missing type' })
    ).toEqual({
      severity: 'error',
      code: ERROR_CODES.INVALID_DOCUMENT,
      message: 'missing type',
      path: '/content/0',
    });
  });

  it('keeps the validator code when there is one and maps arrays', () => {
    expect(
      fromValidationErrors(
        [
          { path: '/a', message: 'one', code: 'E_CUSTOM', value: 3 },
          { path: '/b', message: 'two', suggestion: 'fix' },
        ],
        'warning'
      )
    ).toEqual([
      {
        severity: 'warning',
        code: 'E_CUSTOM',
        message: 'one',
        path: '/a',
        context: { value: 3 },
      },
      {
        severity: 'warning',
        code: ERROR_CODES.INVALID_DOCUMENT,
        message: 'two',
        path: '/b',
        suggestion: 'fix',
      },
    ]);
  });

  it('treats an absent error list as no diagnostics', () => {
    expect(fromValidationErrors(undefined)).toEqual([]);
  });
});

describe('code normalization', () => {
  // The ordinals TypeBox reported for the defects an agent actually makes:
  // an unexpected prop, a wrong type, a missing prop, an unmatched union.
  it('maps TypeBox ordinals onto the published vocabulary', () => {
    expect(normalizeCode('42')).toBe(ERROR_CODES.UNEXPECTED_PROPERTY);
    expect(normalizeCode('45')).toBe(ERROR_CODES.REQUIRED_PROPERTY);
    expect(normalizeCode('62')).toBe(ERROR_CODES.UNION_MISMATCH);
    for (const ordinal of ['6', '14', '41', '54']) {
      expect(normalizeCode(ordinal)).toBe(ERROR_CODES.TYPE_MISMATCH);
    }
    // Bounds, lengths and formats are a value problem, not a type problem.
    for (const ordinal of ['2', '38', '51', '50']) {
      expect(normalizeCode(ordinal)).toBe(ERROR_CODES.VALUE_CONSTRAINT);
    }
  });

  it('maps the cores’ own spellings into the same namespace', () => {
    expect(normalizeCode('required_property')).toBe(
      ERROR_CODES.REQUIRED_PROPERTY
    );
    expect(normalizeCode('unknown_component')).toBe(
      ERROR_CODES.UNKNOWN_COMPONENT
    );
    expect(normalizeCode('unsupported_renderer_feature')).toBe(
      ERROR_CODES.UNSUPPORTED_RENDERER_FEATURE
    );
  });

  it('leaves codes already in the namespace alone', () => {
    expect(normalizeCode(ERROR_CODES.UNKNOWN_HANDLE)).toBe('E_UNKNOWN_HANDLE');
    expect(normalizeCode('W_BLANK_DOCUMENT')).toBe('W_BLANK_DOCUMENT');
  });

  it('falls back rather than leaking an ordinal we cannot name', () => {
    expect(normalizeCode('9999')).toBe(ERROR_CODES.INVALID_DOCUMENT);
    expect(normalizeCode(undefined)).toBe(ERROR_CODES.INVALID_DOCUMENT);
    // A lookup table keyed by a validator's own string has to survive one.
    expect(normalizeCode('constructor')).toBe(ERROR_CODES.INVALID_DOCUMENT);
    expect(normalizeCode('__proto__')).toBe(ERROR_CODES.INVALID_DOCUMENT);
  });

  it('keeps the validator’s own code for debugging', () => {
    expect(
      fromValidationError({
        path: '/a',
        message: 'Expected string',
        code: '54',
      })
    ).toMatchObject({
      code: ERROR_CODES.TYPE_MISMATCH,
      context: { validatorCode: '54' },
    });
  });

  it('reports one missing property once', () => {
    // TypeBox answers an absent required prop twice: it is missing, and then
    // the absent value is the wrong type. Same pointer, one repair.
    const collapsed = validationDiagnostics([
      {
        path: '/children/0/props/text',
        message: 'At /text: Expected required property',
        code: '45',
      },
      {
        path: '/children/0/props/text',
        message: 'At /text: Expected string',
        code: '54',
      },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].code).toBe(ERROR_CODES.REQUIRED_PROPERTY);
  });

  it('keeps a type error at a pointer nothing else complains about', () => {
    const kept = validationDiagnostics([
      { path: '/a', message: 'missing', code: '45' },
      { path: '/b', message: 'Expected string', code: '54' },
    ]);
    expect(kept.map((entry) => entry.code)).toEqual([
      ERROR_CODES.REQUIRED_PROPERTY,
      ERROR_CODES.TYPE_MISMATCH,
    ]);
  });
});

describe('envelopes', () => {
  it('always carries ok and diagnostics', () => {
    expect(success({ artifact: null })).toEqual({
      ok: true,
      diagnostics: [],
      artifact: null,
    });
    expect(failure('E_X', 'boom').ok).toBe(false);
  });

  it('keeps the text block and structuredContent identical', () => {
    const result = toolResult(success({ n: 1 }));
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent
    );
  });
});

describe('guarded', () => {
  it('passes a successful body through untouched', async () => {
    const value = success({ n: 1 });
    await expect(guarded(async () => value)).resolves.toBe(value);
  });

  it('converts a thrown error into E_INTERNAL rather than a protocol error', async () => {
    const result = await guarded(async () => {
      throw new Error('adapter exploded');
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.INTERNAL);
    expect(result.diagnostics[0].message).toBe('adapter exploded');
  });

  it('keeps the stack out of the transcript', async () => {
    // A stack is absolute paths and our own module layout. It goes wherever
    // the client keeps its transcript, the agent can do nothing with it, and
    // nobody asked for their home directory to be published.
    const result = await guarded(async () => {
      throw new Error('adapter exploded');
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].context?.stack).toBeUndefined();
  });

  it('puts it back for whoever is debugging this server', async () => {
    const previous = process.env.JTO_MCP_DEBUG_STACKS;
    process.env.JTO_MCP_DEBUG_STACKS = '1';
    try {
      const result = await guarded(async () => {
        throw new Error('adapter exploded');
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0].context?.stack).toContain(
        'adapter exploded'
      );
    } finally {
      if (previous === undefined) delete process.env.JTO_MCP_DEBUG_STACKS;
      else process.env.JTO_MCP_DEBUG_STACKS = previous;
    }
  });

  it('handles a thrown non-Error', async () => {
    const result = await guarded(async () => {
      throw 'just a string';
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].message).toBe('just a string');
  });

  it('names a missing optional backend as the host problem it is', async () => {
    // `shared`'s renderer loader renames the failure; E_INTERNAL would tell
    // the agent to report a bug instead of running the install line.
    const result = await guarded(async () => {
      const error = new Error(
        'The "office-open" docx renderer requires @office-open/docx, which is not installed.'
      );
      error.name = 'RendererDependencyMissingError';
      throw error;
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.DEPENDENCY_MISSING);
  });
});

describe('the per-request diagnostic sink', () => {
  // Anything installed around server setup is off the stack by the time a
  // request lands, so these prove the sink is live for the duration of a call.
  it('collects what jto-ops emits during the body', async () => {
    const result = await guarded(async () => {
      await Promise.resolve();
      emitDiagnostic(
        'Unknown theme "nope"; keeping the document’s own',
        'warning'
      );
      emitDiagnostic('staged a font', 'info');
      return success({ artifact: null });
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: ERROR_CODES.HOST_NOTE,
        message: 'Unknown theme "nope"; keeping the document’s own',
      },
      {
        severity: 'info',
        code: ERROR_CODES.HOST_NOTE,
        message: 'staged a font',
      },
    ]);
  });

  it('keeps the notes when the body throws', async () => {
    const result = await guarded(async () => {
      emitDiagnostic('Failed to load theme from /etc', 'warning');
      throw new Error('render exploded');
    });
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      ERROR_CODES.INTERNAL,
      ERROR_CODES.HOST_NOTE,
    ]);
  });

  it('reaches the envelope jto_preview keeps under payload', async () => {
    const result = await guarded(async () => {
      emitDiagnostic('Unknown theme "nope"', 'warning');
      return { payload: success({ pages: 1 }), images: [] };
    });
    expect((result as any).payload.diagnostics).toHaveLength(1);
  });

  it('does not echo a warning the tool already reported structurally', async () => {
    // jto-ops mirrors every GenerationWarning to the sink as
    // "<component>: <message>"; the structured copy carries the code.
    const reported = diagnostic('W_FONT_UNRESOLVED', 'Font "Inter" not found', {
      severity: 'warning',
    });
    const result = await guarded(async () => {
      emitDiagnostic('font: Font "Inter" not found', 'warning');
      return success({ artifact: null }, [reported]);
    });
    expect(result.diagnostics).toEqual([reported]);
  });

  it('scopes the collection to one call', async () => {
    await guarded(async () => {
      emitDiagnostic('first call only', 'warning');
      return success({});
    });
    const second = await guarded(async () => success({}));
    expect(second.diagnostics).toEqual([]);
  });
});

// The cores raise warnings under bare SCREAMING_SNAKE names. Those reached the
// wire unprefixed, so `code.startsWith('W_')` — the whole point of the prefix —
// was false for the one class of diagnostic that never blocks.
describe('generation warning codes', () => {
  it('prefixes a core warning into the published namespace', () => {
    expect(normalizeWarningCode('FONT_UNRESOLVED')).toBe('W_FONT_UNRESOLVED');
    expect(normalizeWarningCode('CHART_NO_DATA')).toBe('W_CHART_NO_DATA');
    // shared-docx spells its warnings lower-case; one family, one casing.
    expect(normalizeWarningCode('theme_not_found')).toBe('W_THEME_NOT_FOUND');
  });

  it('names a codeless warning rather than inventing an error', () => {
    expect(normalizeWarningCode(undefined)).toBe('W_GENERATION');
    expect(normalizeWarningCode('')).toBe('W_GENERATION');
  });

  it('leaves an already-published code alone', () => {
    expect(normalizeWarningCode('W_HOST_NOTE')).toBe('W_HOST_NOTE');
    expect(normalizeWarningCode('E_DEPENDENCY_MISSING')).toBe(
      'E_DEPENDENCY_MISSING'
    );
  });

  it('never returns something an agent cannot branch on', () => {
    for (const raw of [
      'FONT_UNRESOLVED',
      'UNKNOWN_SHAPE',
      'CHART_FONT_WEIGHT_DROPPED',
      undefined,
    ]) {
      expect(normalizeWarningCode(raw)).toMatch(/^[EW]_/);
    }
  });
});

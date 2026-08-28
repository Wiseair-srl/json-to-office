import { describe, it, expect, vi } from 'vitest';

vi.mock('../env', async () => {
  const actual = await vi.importActual<typeof import('../env')>('../env');
  return { ...actual, FORMAT: 'docx' };
});

const { EMPTY_POLICY_TEXT, parseQualityPolicy } = await import(
  '../quality-policy'
);
const { buildQualityOptions } = await import('../quality-profiles');

describe('parseQualityPolicy', () => {
  it('treats empty text as no policy at all', () => {
    for (const text of [undefined, '', '   ']) {
      expect(parseQualityPolicy(text)).toEqual({ ok: true, policy: undefined });
    }
  });

  it('treats a structurally empty policy as none', () => {
    // The starter template must not make every request carry a policy that
    // says nothing — the format's defaults have to stay the defaults.
    expect(parseQualityPolicy(EMPTY_POLICY_TEXT)).toEqual({
      ok: true,
      policy: undefined,
    });
  });

  it('accepts rule severity, enable and parameters', () => {
    const result = parseQualityPolicy(
      JSON.stringify({
        rules: {
          'docx/heading-hierarchy': { severity: 'error' },
          'docx/table-width': {
            enabled: false,
            parameters: { toleranceTwips: 40 },
          },
        },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy?.rules?.['docx/heading-hierarchy']).toEqual({
      severity: 'error',
    });
  });

  it('rejects a rule this format does not ship', () => {
    // A pptx id on the docx playground would reach the engine, match nothing,
    // and leave the author believing a rule was configured.
    const result = parseQualityPolicy(
      JSON.stringify({ rules: { 'pptx/slide-density': { severity: 'error' } } })
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('pptx/slide-density');
  });

  it('rejects gate and profile, which have their own controls', () => {
    expect(parseQualityPolicy('{"gate":"warning"}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Gate control'),
    });
    expect(parseQualityPolicy('{"profile":{"id":"x"}}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Profile control'),
    });
  });

  it('requires a reason on every suppression', () => {
    expect(
      parseQualityPolicy(
        JSON.stringify({ suppressions: [{ ruleId: 'docx/table-width' }] })
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('reason') });

    expect(
      parseQualityPolicy(
        JSON.stringify({
          suppressions: [
            {
              ruleId: 'docx/table-width',
              reason: 'Landscape insert, checked.',
            },
          ],
        })
      )
    ).toMatchObject({ ok: true });
  });

  it('names the offending key rather than failing generically', () => {
    expect(
      parseQualityPolicy('{"rules":{"docx/table-width":null}}')
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('docx/table-width'),
    });
    expect(parseQualityPolicy('{"maxDiagnostics":-1}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('maxDiagnostics'),
    });
    expect(parseQualityPolicy('{"onRuleError":"ignore"}')).toMatchObject({
      ok: false,
      error: expect.stringContaining('onRuleError'),
    });
    expect(parseQualityPolicy('{ not json')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Not valid JSON'),
    });
  });

  it('never throws, whatever it is handed', () => {
    for (const text of ['null', '[]', '"a string"', '42', '{"rules":[]}']) {
      expect(() => parseQualityPolicy(text)).not.toThrow();
    }
  });
});

describe('buildQualityOptions with an authored policy', () => {
  const policy = JSON.stringify({
    rules: { 'docx/heading-hierarchy': { severity: 'error' } },
  });

  it('merges the authored policy under the gate control', () => {
    expect(buildQualityOptions(undefined, 'warning', policy)).toEqual({
      policy: {
        rules: { 'docx/heading-hierarchy': { severity: 'error' } },
        gate: 'warning',
      },
    });
  });

  it('sends the policy with no gate when the gate is none', () => {
    expect(buildQualityOptions(undefined, 'none', policy)).toEqual({
      policy: { rules: { 'docx/heading-hierarchy': { severity: 'error' } } },
    });
  });

  it('drops a policy still being typed rather than failing the run', () => {
    // Every keystroke passes through here; a half-written brace must not turn
    // into a 400 on the analysis that follows it.
    expect(buildQualityOptions(undefined, 'none', '{"rules":')).toBeUndefined();
    expect(buildQualityOptions(undefined, 'warning', '{"rules":')).toEqual({
      policy: { gate: 'warning' },
    });
  });

  it('still omits everything when nothing was configured', () => {
    expect(
      buildQualityOptions(undefined, 'none', EMPTY_POLICY_TEXT)
    ).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RendererStatus } from '@json-to-office/shared';
import { assertValidQualityPolicy } from '@json-to-office/quality';
import type {
  PreparedDocument,
  QualityAnalysis,
} from '@json-to-office/quality';
import {
  PluginRegistry,
  type FormatAdapter,
  type GeneratorOptions,
} from '@json-to-office/jto-cli';
import { CacheService } from '../cache';
import { GeneratorService } from '../generator';

/**
 * Unreadable, and deliberately gateless: a policy naming a gate would be
 * rethrown by the "a gate was requested" clause too, so it could not tell the
 * code-matched branch from that one.
 */
const UNREADABLE_POLICY = { maxDiagnostics: -1 };

const DOCUMENT = {
  name: 'docx',
  props: { theme: 'minimal' },
  metadata: { title: 'renderer-cache' },
  children: [{ name: 'paragraph', props: { text: 'Body.' } }],
};

class RecordingAdapter implements FormatAdapter {
  readonly name = 'docx';
  readonly extension = '.docx';
  readonly label = 'document';
  readonly defaultPort = 3003;
  readonly calls: string[] = [];
  qualityCalls = 0;
  preparedQualityCalls = 0;
  prepareCalls = 0;
  preparedRenderCalls = 0;

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    if (options.prepared) this.preparedRenderCalls += 1;
    const renderer =
      options.renderer ?? (json as { renderer?: string }).renderer ?? 'docxjs';
    this.calls.push(renderer);
    return Buffer.from(renderer);
  }

  async createGenerator(): Promise<never> {
    throw new Error('No plugins expected in this test');
  }

  parseJson(input: string | object): unknown {
    return typeof input === 'string' ? JSON.parse(input) : input;
  }

  validateDocument(): { valid: boolean } {
    return { valid: true };
  }

  async analyzeQuality(
    _document: unknown,
    options: GeneratorOptions = {}
  ): Promise<QualityAnalysis> {
    this.qualityCalls += 1;
    // Recorded rather than asserted here: the caller runs this inside a
    // try/catch, which would swallow the assertion failure.
    if (options.prepared) this.preparedQualityCalls += 1;
    const blocking = options.quality?.policy?.gate === 'info';
    return {
      diagnostics: [
        {
          source: 'quality',
          ruleId: 'docx/heading-hierarchy',
          code: 'W_QUALITY_HEADING_SKIP',
          category: 'hierarchy',
          certainty: 'deterministic',
          severity: 'info',
          message: 'Heading level skipped.',
          path: '/children/0',
          suggestion: 'Use the next level.',
          blocking,
          context: {
            code: 'spoofed',
            path: '/spoofed',
            ruleId: 'spoofed/rule',
            blocking: !blocking,
          },
        },
      ],
      counts: { error: 0, warning: 0, info: 1 },
      blocked: blocking,
      truncated: false,
      suppressedCount: 0,
      evaluatedRuleIds: ['docx/heading-hierarchy'],
      ruleErrors: [],
    };
  }

  async prepareDocument(document: unknown): Promise<PreparedDocument> {
    this.prepareCalls += 1;
    return {
      format: 'docx',
      model: document,
      facts: [],
      provenance: {},
    };
  }

  generateSchema(): object {
    return {};
  }

  getBuiltinThemes(): Record<string, never> {
    return {};
  }

  async resolveTheme(): Promise<undefined> {
    return undefined;
  }

  async loadCustomThemes(): Promise<undefined> {
    return undefined;
  }

  async rendererIds(): Promise<readonly string[]> {
    return ['docxjs', 'office-open'];
  }

  async rendererStatuses(): Promise<readonly RendererStatus[]> {
    return [
      { id: 'docxjs', default: true, available: true },
      { id: 'office-open', default: false, available: true },
    ];
  }
}

describe('GeneratorService renderer cache isolation', () => {
  let adapter: RecordingAdapter;
  let cache: CacheService;
  let service: GeneratorService;

  beforeEach(() => {
    PluginRegistry.getInstance().clear();
    adapter = new RecordingAdapter();
    cache = new CacheService();
    service = new GeneratorService(adapter, cache);
  });

  afterEach(() => {
    service.destroy();
    cache.destroy();
    PluginRegistry.getInstance().clear();
  });

  it('separates per-request renderer overrides', async () => {
    const legacy = await service.generate({
      jsonDefinition: DOCUMENT,
      options: { renderer: 'docxjs' },
    });
    const officeOpen = await service.generate({
      jsonDefinition: DOCUMENT,
      options: { renderer: 'office-open' },
    });
    const legacyAgain = await service.generate({
      jsonDefinition: DOCUMENT,
      options: { renderer: 'docxjs' },
    });

    expect(legacy.cached).toBe(false);
    expect(officeOpen.cached).toBe(false);
    expect(legacyAgain.cached).toBe(true);
    expect(legacy.buffer.toString()).toBe('docxjs');
    expect(officeOpen.buffer.toString()).toBe('office-open');
    expect(adapter.calls).toEqual(['docxjs', 'office-open']);
  });

  it('separates top-level renderer discriminators', async () => {
    const legacy = await service.generate({
      jsonDefinition: { ...DOCUMENT, renderer: 'docxjs' },
    });
    const officeOpen = await service.generate({
      jsonDefinition: { ...DOCUMENT, renderer: 'office-open' },
    });

    expect(legacy.cached).toBe(false);
    expect(officeOpen.cached).toBe(false);
    expect(legacy.buffer.toString()).toBe('docxjs');
    expect(officeOpen.buffer.toString()).toBe('office-open');
    expect(adapter.calls).toEqual(['docxjs', 'office-open']);
  });

  it('surfaces quality on validation, generation, and cache hits', async () => {
    const validation = await service.validate(DOCUMENT);
    expect(validation).toMatchObject({
      valid: true,
      qualityAnalysis: {
        blocked: false,
        evaluatedRuleIds: ['docx/heading-hierarchy'],
      },
    });

    const first = await service.generate({ jsonDefinition: DOCUMENT });
    const second = await service.generate({ jsonDefinition: DOCUMENT });
    expect(first.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'quality',
          severity: 'info',
          context: expect.objectContaining({
            code: 'W_QUALITY_HEADING_SKIP',
            path: '/children/0',
            ruleId: 'docx/heading-hierarchy',
            blocking: false,
          }),
        }),
      ])
    );
    expect(second.cached).toBe(true);
    expect(second.warnings).toEqual(first.warnings);
    expect(adapter.qualityCalls).toBe(3);
    expect(adapter.preparedQualityCalls).toBe(3);
    expect(adapter.prepareCalls).toBe(3);
    expect(adapter.preparedRenderCalls).toBe(1);
  });

  it('stops before rendering when policy gates a diagnostic', async () => {
    await expect(
      service.generate({
        jsonDefinition: DOCUMENT,
        options: { quality: { policy: { gate: 'info' } } },
      })
    ).rejects.toMatchObject({
      code: 'QUALITY_GATE_FAILED',
      analysis: { blocked: true },
    });
    expect(adapter.calls).toEqual([]);
    expect(adapter.prepareCalls).toBe(1);
    expect(adapter.preparedQualityCalls).toBe(1);
  });

  it('refuses to render ungated when a requested gate cannot run', async () => {
    adapter.analyzeQuality = async () => {
      throw new Error('rule crashed');
    };

    await expect(
      service.generate({
        jsonDefinition: DOCUMENT,
        options: { quality: { policy: { gate: 'info' } } },
      })
    ).rejects.toThrow('rule crashed');
    expect(adapter.calls).toEqual([]);

    // No gate requested: the analysis is advisory, so the same failure only
    // costs the caller its quality warnings.
    const advisory = await service.generate({ jsonDefinition: DOCUMENT });
    expect(advisory.warnings).toBeNull();
    expect(adapter.calls).toEqual(['docxjs']);
  });

  it('keeps validating when quality analysis throws', async () => {
    adapter.prepareDocument = async () => {
      throw new Error('cannot prepare');
    };

    const result = await service.validate(DOCUMENT);
    expect(result).toEqual({ valid: true });
    expect(adapter.qualityCalls).toBe(0);
  });

  it('returns invalid schema results before preparation or analysis', async () => {
    adapter.validateDocument = () => ({
      valid: false,
      errors: [{ path: '/name', message: 'Expected docx.' }],
    });

    const result = await service.validate({ name: 'pptx' });
    expect(result).toEqual({
      valid: false,
      errors: [{ path: '/name', message: 'Expected docx.' }],
    });
    expect(adapter.prepareCalls).toBe(0);
    expect(adapter.qualityCalls).toBe(0);
  });

  it('propagates an unreadable policy out of generation', async () => {
    // The engine's own guard, standing where the engine runs it. A policy the
    // parser cannot read is the caller's configuration, so it has to survive
    // the catch that turns a failed analysis into a logged warning.
    adapter.analyzeQuality = async (_document, options = {}) => {
      assertValidQualityPolicy(options.quality?.policy);
      throw new Error('policy accepted');
    };

    await expect(
      service.generate({
        jsonDefinition: DOCUMENT,
        options: { quality: { policy: UNREADABLE_POLICY } },
      })
    ).rejects.toMatchObject({
      code: 'QUALITY_POLICY_INVALID',
      message: expect.stringContaining('maxDiagnostics'),
    });
    expect(adapter.calls).toEqual([]);
  });

  it('propagates an unreadable policy out of validation', async () => {
    // Same fault, other entry point: a document defect degrades to "no quality
    // analysis" here, but a policy nothing can parse is not a document defect.
    adapter.analyzeQuality = async (_document, options = {}) => {
      assertValidQualityPolicy(options.quality?.policy);
      throw new Error('policy accepted');
    };

    await expect(
      service.validate(DOCUMENT, {
        quality: { policy: UNREADABLE_POLICY },
      })
    ).rejects.toMatchObject({
      code: 'QUALITY_POLICY_INVALID',
      message: expect.stringContaining('maxDiagnostics'),
    });
  });

  it('refuses to call a gated document valid when the analysis never ran', async () => {
    // An analysis that died for an unnamed reason leaves the requested gate
    // unevaluated. `generate` rejects that; validation answering `valid: true`
    // would promise a generation the same service then refuses.
    adapter.analyzeQuality = async () => {
      throw new Error('facts unavailable');
    };

    await expect(
      service.validate(DOCUMENT, { quality: { policy: { gate: 'warning' } } })
    ).rejects.toThrow('facts unavailable');
    await expect(
      service.validate(DOCUMENT, {
        quality: { policy: { onRuleError: 'throw' } },
      })
    ).rejects.toThrow('facts unavailable');

    // Advisory runs keep degrading to "no quality analysis".
    await expect(
      service.validate(DOCUMENT, { quality: { policy: { gate: 'none' } } })
    ).resolves.toMatchObject({ valid: true });
    await expect(service.validate(DOCUMENT)).resolves.toMatchObject({
      valid: true,
    });
  });
});

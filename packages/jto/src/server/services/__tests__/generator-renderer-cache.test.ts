import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RendererStatus } from '@json-to-office/shared';
import type {
  PreparedDocument,
  QualityAnalysis,
  QualityFinding,
} from '@json-to-office/quality';
import {
  PluginRegistry,
  type FormatAdapter,
  type GeneratorOptions,
} from '@json-to-office/jto-cli';
import { CacheService } from '../cache';
import { GeneratorService } from '../generator';

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

  async qualityCheck(): Promise<QualityFinding[]> {
    return [
      {
        code: 'W_QUALITY_HEADING_SKIP',
        severity: 'info',
        message: 'Heading level skipped.',
        path: '/children/0',
        suggestion: 'Use the next level.',
      },
    ];
  }

  async analyzeQuality(
    _document: unknown,
    options: GeneratorOptions = {}
  ): Promise<QualityAnalysis> {
    this.qualityCalls += 1;
    expect(options.prepared).toBeDefined();
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
      quality: [
        {
          code: 'W_QUALITY_HEADING_SKIP',
          severity: 'info',
        },
      ],
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
          }),
        }),
      ])
    );
    expect(second.cached).toBe(true);
    expect(second.warnings).toEqual(first.warnings);
    expect(adapter.qualityCalls).toBe(3);
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
  });
});

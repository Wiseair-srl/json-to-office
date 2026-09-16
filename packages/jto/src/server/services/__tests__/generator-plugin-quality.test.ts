/**
 * The playground analyses what registered plugins emit (#453): with a plugin
 * loaded, generation and validation hand the plugins to quality preparation
 * instead of skipping the prepared document, and render the bytes through the
 * plugin generator as before.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RendererStatus } from '@json-to-office/shared';
import type {
  PreparedDocument,
  QualityAnalysis,
} from '@json-to-office/quality';
import {
  PluginRegistry,
  type FormatAdapter,
  type GeneratorOptions,
  type GeneratorResult,
} from '@json-to-office/jto-cli';
import { CacheService } from '../cache';
import { GeneratorService } from '../generator';

const PLUGIN = { name: 'revenue-table', versions: {} };

const DOCUMENT = {
  name: 'docx',
  props: { metadata: { title: 'plugin-quality' } },
  children: [{ name: 'revenue-table', props: { label: 'Segment' } }],
};

class PluginAwareAdapter implements FormatAdapter {
  readonly name = 'docx';
  readonly extension = '.docx';
  readonly label = 'document';
  readonly defaultPort = 3003;
  readonly preparedWith: Array<readonly unknown[] | undefined> = [];
  readonly analyzedWith: Array<readonly unknown[] | undefined> = [];
  analyzedPrepared = 0;
  pluginRenders = 0;

  async generateBuffer(): Promise<Buffer> {
    throw new Error(
      'A document naming a plugin renders through the plugin generator'
    );
  }

  async createGenerator(plugins: any[]): Promise<GeneratorResult> {
    return {
      generateBuffer: async () => {
        this.pluginRenders += 1;
        return Buffer.from(plugins.map((plugin) => plugin.name).join(','));
      },
      hasPlugins: true,
      pluginNames: plugins.map((plugin) => plugin.name),
    };
  }

  parseJson(input: string | object): unknown {
    return typeof input === 'string' ? JSON.parse(input) : input;
  }

  validateDocument(): { valid: boolean } {
    // The standard components alone do not know the plugin.
    return { valid: false };
  }

  async validateDocumentWithPlugins(): Promise<{ valid: boolean }> {
    return { valid: true };
  }

  async prepareDocument(
    document: unknown,
    options: GeneratorOptions = {}
  ): Promise<PreparedDocument> {
    this.preparedWith.push(options.plugins);
    return { format: 'docx', model: document, facts: [], provenance: {} };
  }

  async analyzeQuality(
    _document: unknown,
    options: GeneratorOptions = {}
  ): Promise<QualityAnalysis> {
    this.analyzedWith.push(options.plugins);
    if (options.prepared) this.analyzedPrepared += 1;
    return {
      diagnostics: [],
      counts: { error: 0, warning: 0, info: 0 },
      blocked: false,
      truncated: false,
      suppressedCount: 0,
      evaluatedRuleIds: [],
      ruleErrors: [],
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
    return ['docxjs'];
  }

  async rendererStatuses(): Promise<readonly RendererStatus[]> {
    return [{ id: 'docxjs', default: true, available: true }];
  }
}

describe('GeneratorService quality with registered plugins', () => {
  let adapter: PluginAwareAdapter;
  let cache: CacheService;
  let service: GeneratorService;

  beforeEach(() => {
    PluginRegistry.getInstance().clear();
    // The registry loads plugins from disk; the map is what it serves.
    (
      PluginRegistry.getInstance() as unknown as {
        plugins: Map<string, unknown>;
      }
    ).plugins.set(PLUGIN.name, PLUGIN);
    adapter = new PluginAwareAdapter();
    cache = new CacheService();
    service = new GeneratorService(adapter, cache);
  });

  afterEach(() => {
    service.destroy();
    cache.destroy();
    PluginRegistry.getInstance().clear();
  });

  it('prepares and analyses generation with the plugins, then renders through them', async () => {
    const result = await service.generate({ jsonDefinition: DOCUMENT });

    expect(adapter.preparedWith).toEqual([[PLUGIN]]);
    expect(adapter.analyzedWith).toEqual([[PLUGIN]]);
    expect(adapter.analyzedPrepared).toBe(1);
    expect(adapter.pluginRenders).toBe(1);
    expect(result.buffer.toString()).toBe(PLUGIN.name);
  });

  it('prepares and analyses validation with the plugins', async () => {
    const validation = await service.validate(DOCUMENT);

    expect(validation).toMatchObject({ valid: true });
    expect(adapter.preparedWith).toEqual([[PLUGIN]]);
    expect(adapter.analyzedWith).toEqual([[PLUGIN]]);
    expect(adapter.analyzedPrepared).toBe(1);
  });
});

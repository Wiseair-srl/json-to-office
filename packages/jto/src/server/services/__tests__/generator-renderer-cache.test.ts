import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
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
});

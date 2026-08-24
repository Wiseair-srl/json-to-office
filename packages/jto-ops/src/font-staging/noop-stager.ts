import type { FontStager, FontStageHandle, FontStageOptions } from './types';

export class NoopFontStager implements FontStager {
  // Signature matches FontStager; every parameter (including `options`) is
  // deliberately ignored on platforms with no staging mechanism.
  async stage(
    _fonts?: unknown,
    _tempDir?: string,
    _options?: FontStageOptions
  ): Promise<FontStageHandle> {
    return {
      envOverrides: {},
      cleanup: async () => {},
    };
  }
}

import type { FontStager, FontStageHandle } from './types';

export class NoopFontStager implements FontStager {
  async stage(): Promise<FontStageHandle> {
    return {
      envOverrides: {},
      cleanup: async () => {},
    };
  }
}

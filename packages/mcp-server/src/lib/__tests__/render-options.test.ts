import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { resolveThemePathOption } from '../render-options.js';

describe('resolveThemePathOption', () => {
  it('resolves a relative JSON theme against baseDir', () => {
    const resolved = resolveThemePathOption(
      'themes/corporate.json',
      '/workspace/project'
    );
    expect(resolved).toEqual({
      ok: true,
      path: path.resolve('/workspace/project/themes/corporate.json'),
    });
  });

  it.each(['theme.js', 'theme.mjs', 'theme.cjs', 'theme.ts', 'theme.JSON'])(
    'rejects executable or ambiguous theme path %s',
    (themePath) => {
      const resolved = resolveThemePathOption(themePath, '/workspace');
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.diagnostics[0].code).toBe('E_INVALID_THEME_PATH');
    }
  );
});

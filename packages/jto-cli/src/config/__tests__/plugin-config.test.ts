import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginConfigService } from '../plugin-config.js';

function configDir(config: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'jto-plugin-config-'));
  writeFileSync(
    join(directory, '.json-to-office.config.json'),
    JSON.stringify(config)
  );
  return directory;
}

describe('PluginConfigService.mergeWithOptions', () => {
  const service = PluginConfigService.getInstance();

  beforeEach(() => {
    service.clearConfig();
  });

  it('keeps config-file values when the matching flags are absent', async () => {
    await service.loadConfig(
      configDir({
        theme: 'corporate',
        themePath: './brand-theme.json',
        aliases: { w: 'weather' },
        validation: { allowUnknownFields: true },
      })
    );

    // Shape the CLI passes when no flag was supplied.
    const merged = service.mergeWithOptions({
      theme: undefined,
      themePath: undefined,
      validation: { strict: undefined },
    });

    expect(merged.theme).toBe('corporate');
    expect(merged.themePath).toBe('./brand-theme.json');
    expect(merged.aliases).toEqual({ w: 'weather' });
    expect(merged.validation).toEqual({ allowUnknownFields: true });
  });

  it('still lets supplied flags win', async () => {
    await service.loadConfig(configDir({ theme: 'corporate' }));

    const merged = service.mergeWithOptions({
      theme: 'modern',
      themePath: undefined,
    });

    expect(merged.theme).toBe('modern');
  });

  it('lets a --theme-path flag win over a config-file themePath', async () => {
    await service.loadConfig(configDir({ themePath: './brand.json' }));

    const merged = service.mergeWithOptions({
      theme: undefined,
      themePath: './override.json',
    });

    expect(merged.themePath).toBe('./override.json');
  });

  // themePath is resolved before theme, so a surviving config-file value of
  // either kind would silently outrank the flag.
  it('drops a config-file themePath when --theme is supplied', async () => {
    await service.loadConfig(configDir({ themePath: './brand.json' }));

    const merged = service.mergeWithOptions({
      theme: 'modern',
      themePath: undefined,
    });

    expect(merged.theme).toBe('modern');
    expect(merged.themePath).toBeUndefined();
  });

  it('drops a config-file theme when --theme-path is supplied', async () => {
    await service.loadConfig(configDir({ theme: 'corporate' }));

    const merged = service.mergeWithOptions({
      theme: undefined,
      themePath: './override.json',
    });

    expect(merged.themePath).toBe('./override.json');
    expect(merged.theme).toBeUndefined();
  });

  it('keeps a CLI-supplied false over a config-file true', async () => {
    await service.loadConfig(
      configDir({ validation: { allowUnknownFields: true } })
    );

    const merged = service.mergeWithOptions({
      validation: { allowUnknownFields: false },
    });

    expect(merged.validation?.allowUnknownFields).toBe(false);
  });
});

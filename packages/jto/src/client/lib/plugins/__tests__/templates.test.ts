import { describe, expect, it } from 'vitest';
import {
  componentNameFromFileName,
  declaredComponentName,
  pluginStarterSource,
  renameDeclaredComponent,
} from '../templates';

describe('plugin templates', () => {
  it('derives a component name from the file name', () => {
    expect(componentNameFromFileName('kpi-tile.component.ts')).toBe('kpi-tile');
    expect(componentNameFromFileName('My Callout.component.ts')).toBe(
      'my-callout'
    );
    expect(componentNameFromFileName('.component.ts')).toBe('custom-block');
  });

  it('starters declare the name they were seeded with, in both formats', () => {
    for (const format of ['docx', 'pptx'] as const) {
      const source = pluginStarterSource(format, 'kpi-tile');
      expect(declaredComponentName(source)).toBe('kpi-tile');
      // Written against the public import path of the running format.
      expect(source).toMatch(
        new RegExp(`from '@json-to-office/[a-z-]*${format}[^']*'`)
      );
    }
  });

  it('renames the declared name and nothing else', () => {
    const source = pluginStarterSource('docx', 'weather');
    const renamed = renameDeclaredComponent(source, 'weather-custom');
    expect(declaredComponentName(renamed)).toBe('weather-custom');
    // Only the literal moved: the rest of the file is byte-identical.
    expect(renamed.replace('weather-custom', 'weather')).toBe(source);
  });

  it('leaves a source without a declared name alone', () => {
    const source = 'export default 42;';
    expect(declaredComponentName(source)).toBeNull();
    expect(renameDeclaredComponent(source, 'x')).toBe(source);
  });
});

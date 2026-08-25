import { describe, expect, it } from 'vitest';
import {
  FeatureRequirementCollector,
  RendererRegistry,
  assertRendererSupports,
  diagnoseUnsupportedFeatures,
} from '../capabilities';
import { UnsupportedRendererFeatureError } from '../diagnostics';
import type { OfficeRenderer } from '../types';

type TestFeature = 'tables' | 'charts' | 'notes' | 'transitions';

function fakeRenderer(
  id: string,
  capabilities: TestFeature[]
): Pick<
  OfficeRenderer<unknown, TestFeature, string>,
  'id' | 'format' | 'capabilities'
> {
  return { id, format: 'pptx', capabilities: new Set(capabilities) };
}

describe('FeatureRequirementCollector', () => {
  it('starts empty', () => {
    const collector = new FeatureRequirementCollector<TestFeature>();
    expect(collector.isEmpty()).toBe(true);
    expect(collector.list()).toEqual([]);
    expect(collector.features()).toEqual([]);
  });

  it('records requirements in first-seen order', () => {
    const collector = new FeatureRequirementCollector<TestFeature>();
    collector.require('charts', 'slides[1].elements[0]');
    collector.require('tables', 'slides[0].elements[2]');

    expect(collector.list()).toEqual([
      { feature: 'charts', path: 'slides[1].elements[0]' },
      { feature: 'tables', path: 'slides[0].elements[2]' },
    ]);
    expect(collector.features()).toEqual(['charts', 'tables']);
    expect(collector.isEmpty()).toBe(false);
  });

  it('collapses duplicate feature/path pairs', () => {
    const collector = new FeatureRequirementCollector<TestFeature>();
    collector.require('tables', 'slides[0]');
    collector.require('tables', 'slides[0]');
    collector.require('tables', 'slides[0]', 'ignored on the repeat');

    expect(collector.list()).toHaveLength(1);
  });

  it('keeps the same feature at different paths', () => {
    const collector = new FeatureRequirementCollector<TestFeature>();
    collector.require('tables', 'slides[0]');
    collector.require('tables', 'slides[1]');

    expect(collector.list()).toHaveLength(2);
    expect(collector.features()).toEqual(['tables']);
  });

  it('carries an optional detail', () => {
    const collector = new FeatureRequirementCollector<TestFeature>();
    collector.require('charts', 'slides[0].chart', 'doughnut');

    expect(collector.list()[0]).toEqual({
      feature: 'charts',
      path: 'slides[0].chart',
      detail: 'doughnut',
    });
  });

  it('does not share state between instances', () => {
    const a = new FeatureRequirementCollector<TestFeature>();
    const b = new FeatureRequirementCollector<TestFeature>();
    a.require('tables', 'slides[0]');

    expect(b.isEmpty()).toBe(true);
  });
});

describe('diagnoseUnsupportedFeatures', () => {
  it('returns nothing when every requirement is covered', () => {
    const diagnostics = diagnoseUnsupportedFeatures(
      [
        { feature: 'tables' as TestFeature, path: 'slides[0]' },
        { feature: 'charts' as TestFeature, path: 'slides[1]' },
      ],
      new Set<TestFeature>(['tables', 'charts']),
      'office-open'
    );

    expect(diagnostics).toEqual([]);
  });

  it('reports one error-severity diagnostic per unsupported requirement', () => {
    const diagnostics = diagnoseUnsupportedFeatures(
      [
        { feature: 'tables' as TestFeature, path: 'slides[0]' },
        { feature: 'charts' as TestFeature, path: 'slides[1]' },
        { feature: 'charts' as TestFeature, path: 'slides[2]' },
      ],
      new Set<TestFeature>(['tables']),
      'office-open'
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.severity === 'error')).toBe(true);
    expect(diagnostics.map((d) => d.path)).toEqual(['slides[1]', 'slides[2]']);
    expect(diagnostics[0].message).toContain('office-open');
    expect(diagnostics[0].message).toContain('charts');
  });

  it('folds the detail into the message', () => {
    const [diagnostic] = diagnoseUnsupportedFeatures(
      [
        {
          feature: 'charts' as TestFeature,
          path: 'slides[0]',
          detail: 'doughnut',
        },
      ],
      new Set<TestFeature>(),
      'office-open'
    );

    expect(diagnostic.message).toContain('doughnut');
  });
});

describe('assertRendererSupports', () => {
  it('passes when the renderer covers everything required', () => {
    expect(() =>
      assertRendererSupports(
        [{ feature: 'tables' as TestFeature, path: 'slides[0]' }],
        fakeRenderer('pptxgenjs', ['tables', 'charts'])
      )
    ).not.toThrow();
  });

  it('passes when nothing is required', () => {
    expect(() =>
      assertRendererSupports([], fakeRenderer('office-open', []))
    ).not.toThrow();
  });

  it('throws one aggregated error listing every gap', () => {
    let caught: UnsupportedRendererFeatureError<TestFeature> | undefined;
    try {
      assertRendererSupports(
        [
          { feature: 'charts' as TestFeature, path: 'slides[1].chart' },
          { feature: 'notes' as TestFeature, path: 'slides[2].notes' },
          { feature: 'charts' as TestFeature, path: 'slides[3].chart' },
          { feature: 'tables' as TestFeature, path: 'slides[0].table' },
        ],
        fakeRenderer('office-open', ['tables'])
      );
    } catch (error) {
      caught = error as UnsupportedRendererFeatureError<TestFeature>;
    }

    expect(caught).toBeInstanceOf(UnsupportedRendererFeatureError);
    expect(caught?.rendererId).toBe('office-open');
    expect(caught?.format).toBe('pptx');
    expect(caught?.features).toEqual(['charts', 'notes']);
    expect(caught?.paths).toEqual([
      'slides[1].chart',
      'slides[2].notes',
      'slides[3].chart',
    ]);
    expect(caught?.diagnostics).toHaveLength(3);
  });
});

describe('RendererRegistry', () => {
  type Ir = { schemaVersion: 1 };
  type Id = 'primary' | 'secondary';

  function renderer(id: Id): OfficeRenderer<Ir, TestFeature, Id> {
    return {
      id,
      format: 'pptx',
      capabilities: new Set<TestFeature>(['tables']),
      render: async () => new Uint8Array([1, 2, 3]),
    };
  }

  function registry(): RendererRegistry<Ir, TestFeature, Id> {
    const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
    reg.register('primary', async () => renderer('primary'));
    reg.register('secondary', async () => renderer('secondary'));
    return reg;
  }

  it('resolves the default when no id is given', async () => {
    const resolved = await registry().resolve();
    expect(resolved.id).toBe('primary');
  });

  it('resolves an explicit id', async () => {
    const resolved = await registry().resolve('secondary');
    expect(resolved.id).toBe('secondary');
  });

  it('reports the registered ids and the default', () => {
    const reg = registry();
    expect(reg.ids()).toEqual(['primary', 'secondary']);
    expect(reg.getDefaultId()).toBe('primary');
    expect(reg.has('primary')).toBe(true);
    expect(reg.has('nope')).toBe(false);
  });

  it('throws with the valid ids for an unknown renderer', async () => {
    await expect(registry().resolve('nope' as Id)).rejects.toThrow(
      /Unknown pptx renderer "nope".*"primary", "secondary"/s
    );
  });

  it('only invokes the factory of the selected renderer', async () => {
    let secondaryLoads = 0;
    const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
    reg.register('primary', async () => renderer('primary'));
    reg.register('secondary', async () => {
      secondaryLoads += 1;
      return renderer('secondary');
    });

    await reg.resolve('primary');
    expect(secondaryLoads).toBe(0);

    await reg.resolve('secondary');
    expect(secondaryLoads).toBe(1);
  });

  it('turns a missing optional dependency into an install hint', async () => {
    const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
    reg.register('primary', async () => {
      throw new Error(
        "Cannot find package '@office-open/pptx' imported from x"
      );
    });

    await expect(reg.resolve('primary')).rejects.toThrow(
      /requires @office-open\/pptx, which is not installed.*pnpm add @office-open\/pptx/s
    );
  });

  it('re-throws unrelated factory failures untouched', async () => {
    const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
    reg.register('primary', async () => {
      throw new Error('boom');
    });

    await expect(reg.resolve('primary')).rejects.toThrow('boom');
  });

  describe('statuses', () => {
    it('reports each renderer, the default among them', async () => {
      expect(await registry().statuses()).toEqual([
        { id: 'primary', default: true, available: true },
        { id: 'secondary', default: false, available: true },
      ]);
    });

    it('carries the install line for a backend that will not load', async () => {
      const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
      reg.register('primary', async () => renderer('primary'));
      reg.register('secondary', async () => {
        throw new Error("Cannot find package '@office-open/pptx' from x");
      });

      const [, secondary] = await reg.statuses();
      expect(secondary).toMatchObject({
        id: 'secondary',
        available: false,
        installHint: 'pnpm add @office-open/pptx',
      });
      expect(secondary.reason).toContain('not installed');
    });

    it('probes once and answers from the cache after', async () => {
      let loads = 0;
      const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
      reg.register('primary', async () => {
        loads += 1;
        return renderer('primary');
      });

      // `jto_validate` runs after every edit; the probe must not cost a
      // package import each time.
      await reg.statuses();
      await reg.statuses();
      expect(loads).toBe(1);
    });

    it('shares one probe between concurrent callers', async () => {
      let loads = 0;
      const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
      reg.register('primary', async () => {
        loads += 1;
        return renderer('primary');
      });

      await Promise.all([reg.statuses(), reg.statuses(), reg.statuses()]);
      expect(loads).toBe(1);
    });

    it('sees a renderer registered after the first probe', async () => {
      const reg = new RendererRegistry<Ir, TestFeature, Id>('pptx', 'primary');
      reg.register('primary', async () => renderer('primary'));
      expect((await reg.statuses()).map((s) => s.id)).toEqual(['primary']);

      // Without dropping the cache on register, this answer would omit
      // 'secondary' for the life of the process.
      reg.register('secondary', async () => renderer('secondary'));
      expect((await reg.statuses()).map((s) => s.id)).toEqual([
        'primary',
        'secondary',
      ]);
    });
  });
});

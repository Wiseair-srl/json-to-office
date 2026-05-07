import { describe, it, expect, afterEach } from 'vitest';
import { Type } from '@sinclair/typebox';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createComponent, createVersion } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { UnknownPreservedComponentError } from '../validation';
import { ensureThemeDefaults } from '../../themes/defaults';
import type { ComponentDefinition } from '../../types';

const testTheme = ensureThemeDefaults({
  name: 'test',
  displayName: 'Test Theme',
  description: 'Simple theme for testing',
});

const greetingComponent = createComponent({
  name: 'greeting',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object(
        { name: Type.String() },
        { additionalProperties: false }
      ),
      render: async ({ props }): Promise<ComponentDefinition[]> => [
        { name: 'heading', props: { level: 2, text: `Hello ${props.name}!` } },
      ],
    }),
  },
});

const summaryComponent = createComponent({
  name: 'summary',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object(
        { points: Type.Array(Type.String()) },
        { additionalProperties: false }
      ),
      render: async ({ props }): Promise<ComponentDefinition[]> => [
        { name: 'list', props: { items: props.points } },
      ],
    }),
  },
});

const tempPaths: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map((p) =>
      fs.rm(p, { force: true }).catch(() => {
        /* best-effort */
      })
    )
  );
});

function tmpPath(suffix: string): string {
  const p = path.join(
    os.tmpdir(),
    `preserved-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`
  );
  tempPaths.push(p);
  return p;
}

describe('preserveCustomComponents', () => {
  it('omitting the option produces no preservedDefinition', async () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    const result = await generator.generate({
      name: 'docx',
      props: { metadata: { title: 't' } },
      children: [{ name: 'greeting', props: { name: 'Alice' } }],
    });

    expect(result.preservedDefinition).toBeUndefined();
    expect(result.standardDefinition.children!.length).toBe(1);
    expect(result.standardDefinition.children![0].name).toBe('heading');
  });

  it('empty preserveCustomComponents array produces no preservedDefinition', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const result = await generator.generate(
      {
        name: 'docx',
        props: {},
        children: [{ name: 'greeting', props: { name: 'Bob' } }],
      },
      { preserveCustomComponents: [] }
    );

    expect(result.preservedDefinition).toBeUndefined();
  });

  it('preserves only listed components, expands the rest', async () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    const result = await generator.generate(
      {
        name: 'docx',
        props: {},
        children: [
          { name: 'greeting', props: { name: 'Alice' } },
          { name: 'summary', props: { points: ['p1', 'p2'] } },
        ],
      },
      { preserveCustomComponents: ['greeting'] }
    );

    expect(result.preservedDefinition).toBeDefined();
    const children = result.preservedDefinition!.children!;
    expect(children).toHaveLength(2);
    // Greeting kept verbatim
    expect(children[0]).toMatchObject({
      name: 'greeting',
      props: { name: 'Alice' },
    });
    // Summary expanded
    expect((children[1] as any).name).toBe('list');

    // standardDefinition unchanged: both customs fully expanded
    expect(result.standardDefinition.children!.map((c: any) => c.name)).toEqual(
      ['heading', 'list']
    );
  });

  it('preserved subtree children are NOT recursed (verbatim)', async () => {
    // 'container' is a custom component that has authored children including
    // a non-preserved 'summary'. When 'container' is preserved, the summary
    // inside it must remain un-expanded.
    const containerComponent = createComponent({
      name: 'container',
      versions: {
        '1.0.0': createVersion({
          hasChildren: true,
          propsSchema: Type.Object({}, { additionalProperties: false }),
          render: async ({ children }): Promise<ComponentDefinition[]> =>
            (children ?? []) as ComponentDefinition[],
        }),
      },
    });

    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(containerComponent)
      .addComponent(summaryComponent);

    const result = await generator.generate(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'container',
            props: {},
            children: [{ name: 'summary', props: { points: ['x'] } } as any],
          },
        ],
      } as any,
      { preserveCustomComponents: ['container'] }
    );

    const container: any = result.preservedDefinition!.children![0];
    expect(container.name).toBe('container');
    // Verbatim: child still says 'summary', NOT expanded to 'list'
    expect(container.children).toHaveLength(1);
    expect(container.children[0].name).toBe('summary');
  });

  it('throws UnknownPreservedComponentError for unregistered names', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    await expect(
      generator.generate(
        {
          name: 'docx',
          props: {},
          children: [{ name: 'greeting', props: { name: 'A' } }],
        },
        { preserveCustomComponents: ['greeting', 'typo-name'] }
      )
    ).rejects.toBeInstanceOf(UnknownPreservedComponentError);

    try {
      await generator.generate(
        {
          name: 'docx',
          props: {},
          children: [{ name: 'greeting', props: { name: 'A' } }],
        },
        { preserveCustomComponents: ['typo-name'] }
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownPreservedComponentError);
      const e = err as UnknownPreservedComponentError;
      expect(e.unknownNames).toEqual(['typo-name']);
      expect(e.registeredNames).toEqual(['greeting']);
      expect(e.code).toBe('UNKNOWN_PRESERVED_COMPONENT');
    }
  });

  it('preserves nested customs inside standard containers', async () => {
    const generator = createDocumentGenerator({ theme: testTheme })
      .addComponent(greetingComponent)
      .addComponent(summaryComponent);

    const result = await generator.generate(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'section',
            props: { title: 'S' },
            children: [
              { name: 'greeting', props: { name: 'Alice' } },
              { name: 'summary', props: { points: ['a'] } },
            ],
          },
        ] as any,
      },
      { preserveCustomComponents: ['greeting'] }
    );

    const section: any = result.preservedDefinition!.children![0];
    expect(section.name).toBe('section');
    expect(section.children).toHaveLength(2);
    expect(section.children[0].name).toBe('greeting');
    expect(section.children[1].name).toBe('list');
  });

  it('generateFile writes sidecar at default path', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const outPath = tmpPath('.docx');
    const result = await generator.generateFile(
      {
        name: 'docx',
        props: {},
        children: [{ name: 'greeting', props: { name: 'A' } }],
      },
      outPath,
      { preserveCustomComponents: ['greeting'] }
    );

    const expectedSidecar = outPath.replace(/\.docx$/, '-preserved.json');
    tempPaths.push(expectedSidecar);
    expect(result.preservedOutputPath).toBe(expectedSidecar);

    const sidecarContents = await fs.readFile(expectedSidecar, 'utf8');
    const parsed = JSON.parse(sidecarContents);
    expect(parsed.children[0]).toMatchObject({
      name: 'greeting',
      props: { name: 'A' },
    });
  });

  it('generateFile honors preservedOutputPath override', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const outPath = tmpPath('.docx');
    const sidecarPath = tmpPath('-custom.json');
    const result = await generator.generateFile(
      {
        name: 'docx',
        props: {},
        children: [{ name: 'greeting', props: { name: 'A' } }],
      },
      outPath,
      {
        preserveCustomComponents: ['greeting'],
        preservedOutputPath: sidecarPath,
      }
    );

    expect(result.preservedOutputPath).toBe(sidecarPath);
    const sidecarContents = await fs.readFile(sidecarPath, 'utf8');
    expect(JSON.parse(sidecarContents).children[0].name).toBe('greeting');

    // Default path NOT written
    const defaultPath = outPath.replace(/\.docx$/, '-preserved.json');
    await expect(fs.access(defaultPath)).rejects.toBeDefined();
  });

  it('generateFile writes no sidecar when option is omitted', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const outPath = tmpPath('.docx');
    const result = await generator.generateFile(
      {
        name: 'docx',
        props: {},
        children: [{ name: 'greeting', props: { name: 'A' } }],
      },
      outPath
    );

    expect(result.preservedDefinition).toBeUndefined();
    expect(result.preservedOutputPath).toBeUndefined();
    const defaultPath = outPath.replace(/\.docx$/, '-preserved.json');
    await expect(fs.access(defaultPath)).rejects.toBeDefined();
  });

  it('generateBuffer returns preservedDefinition', async () => {
    const generator = createDocumentGenerator({
      theme: testTheme,
    }).addComponent(greetingComponent);

    const result = await generator.generateBuffer(
      {
        name: 'docx',
        props: {},
        children: [{ name: 'greeting', props: { name: 'A' } }],
      },
      { preserveCustomComponents: ['greeting'] }
    );

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.preservedDefinition).toBeDefined();
    expect((result.preservedDefinition as any).children[0].name).toBe(
      'greeting'
    );
  });
});

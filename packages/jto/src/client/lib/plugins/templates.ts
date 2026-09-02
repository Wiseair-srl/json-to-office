import type { PluginFormat } from './types';

/**
 * Starter source for a new plugin file.
 *
 * Written against the public import paths, so the same file compiles in the
 * browser and, once downloaded next to a project, on disk with the CLI. Each
 * one reads the theme so the first render already shows the plugin is theme
 * aware, and carries a JSDoc `@example` the sidebar and editor pick up.
 */

function componentIdentifier(componentName: string): string {
  const camel = componentName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join('');
  return `${camel || 'custom'}Component`;
}

function docxTemplate(componentName: string): string {
  const identifier = componentIdentifier(componentName);
  return `import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/core-docx';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

/**
 * Props are a TypeBox schema: it validates the JSON, drives editor
 * completions, and types \`props\` inside render().
 */
const PropsSchema = Type.Object(
  {
    title: Type.String({ description: 'Short heading for the callout' }),
    text: Type.String({
      description: 'Body text; inline markdown such as **bold** is allowed',
    }),
    tone: Type.Optional(
      Type.Union([Type.Literal('info'), Type.Literal('warning')], {
        default: 'info',
        description: 'Which theme colour the heading takes',
      })
    ),
  },
  { additionalProperties: false }
);

/**
 * A titled callout: a heading and a paragraph, coloured from the active theme.
 *
 * @example
 * \`\`\`json
 * {
 *   "name": "${componentName}",
 *   "props": {
 *     "title": "Note",
 *     "text": "This block was produced by a plugin written in the playground.",
 *     "tone": "info"
 *   }
 * }
 * \`\`\`
 */
export const ${identifier} = createComponent({
  name: '${componentName}',
  versions: {
    '1.0.0': createVersion({
      propsSchema: PropsSchema,
      description: 'Titled callout coloured from the theme',
      render: async ({ props, theme, addWarning }) => {
        const color =
          props.tone === 'warning' ? theme.colors.secondary : theme.colors.accent;
        if (!props.text.trim()) {
          addWarning('Callout has no text', { title: props.title });
        }
        const components: ComponentDefinition[] = [
          {
            name: 'paragraph',
            props: {
              text: props.title,
              font: { bold: true, size: 12, color },
              spacing: { before: 8, after: 2 },
            },
          },
          {
            name: 'paragraph',
            props: { text: props.text, spacing: { after: 10 } },
          },
        ];
        return components;
      },
    }),
  },
});
`;
}

function pptxTemplate(componentName: string): string {
  const identifier = componentIdentifier(componentName);
  return `import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/json-to-pptx';
import type { PptxComponentDefinition } from '@json-to-office/shared-pptx';

/**
 * Props are a TypeBox schema: it validates the JSON, drives editor
 * completions, and types \`props\` inside render().
 */
const PropsSchema = Type.Object(
  {
    label: Type.String({ description: 'What the number measures' }),
    value: Type.String({ description: 'The number, already formatted' }),
    x: Type.Optional(Type.Number({ default: 0.5, description: 'Left edge, inches' })),
    y: Type.Optional(Type.Number({ default: 1.5, description: 'Top edge, inches' })),
    w: Type.Optional(Type.Number({ default: 3, description: 'Width, inches' })),
  },
  { additionalProperties: false }
);

/**
 * A KPI tile: a large value over its label, coloured from the active theme.
 *
 * @example
 * \`\`\`json
 * {
 *   "name": "${componentName}",
 *   "props": { "label": "Revenue", "value": "$4.2M", "x": 0.5, "y": 1.5, "w": 3 }
 * }
 * \`\`\`
 */
export const ${identifier} = createComponent({
  name: '${componentName}',
  versions: {
    '1.0.0': createVersion({
      propsSchema: PropsSchema,
      description: 'KPI tile: large value over its label',
      render: async ({ props, theme, addWarning }) => {
        const x = props.x ?? 0.5;
        const y = props.y ?? 1.5;
        const w = props.w ?? 3;
        if (!props.value.trim()) {
          addWarning('KPI tile has no value', { label: props.label });
        }
        const components: PptxComponentDefinition[] = [
          {
            name: 'text',
            props: {
              text: props.value,
              x,
              y,
              w,
              h: 0.9,
              fontSize: 36,
              bold: true,
              color: theme.colors.primary,
            },
          },
          {
            name: 'text',
            props: {
              text: props.label,
              x,
              y: y + 0.9,
              w,
              h: 0.4,
              fontSize: 12,
              color: theme.colors.text2 ?? theme.colors.text,
            },
          },
        ];
        return components;
      },
    }),
  },
});
`;
}

export function pluginStarterSource(
  format: PluginFormat,
  componentName: string
): string {
  return format === 'docx'
    ? docxTemplate(componentName)
    : pptxTemplate(componentName);
}

/**
 * The `name` a plugin source declares in `createComponent({ name: '…' })`,
 * or null when the literal cannot be found.
 */
export function declaredComponentName(source: string): string | null {
  const match = source.match(
    /createComponent\s*\(\s*\{[^}]*?\bname\s*:\s*(['"`])([^'"`]+)\1/
  );
  return match ? match[2] : null;
}

/**
 * A copy of a disk plugin keeps that plugin's name, and the copy would then
 * lose to it. Rename the literal so the fork starts as its own component.
 */
export function renameDeclaredComponent(
  source: string,
  newName: string
): string {
  return source.replace(
    /(createComponent\s*\(\s*\{[^}]*?\bname\s*:\s*)(['"`])([^'"`]+)\2/,
    (_match, head: string, quote: string) => `${head}${quote}${newName}${quote}`
  );
}

/**
 * The component name to seed a new plugin with, from its file name:
 * `kpi-tile.component.ts` → `kpi-tile`.
 */
export function componentNameFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.component\.ts$/i, '')
    .replace(/\.ts$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return 'custom-block';
  return /^[a-z]/.test(base) ? base : `x-${base}`;
}

/**
 * The discovery resources.
 *
 * The same knowledge `jto_discover` and `jto_describe_component` serve, offered
 * the other way round: as documents a client can attach, cache and show a user,
 * rather than calls the model has to spend a turn on. Both exist because
 * clients differ — many render resources and never call a discovery tool,
 * plenty support tools and no resources at all — and #204 requires the two
 * views to agree, which `discovery-drift.test.ts` enforces.
 *
 * URIs are `jto://<kind>[/<format>/<what>]` and stable: a client that pinned
 * `jto://schema/docx/document` last release must still find it here.
 *
 * Every body is built on read, never at registration. The DOCX document schema
 * is over 3 MB; a client that only ever calls tools should not pay for it, and
 * a client that asks twice gets it from the same memo the tools use.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import type { FormatName } from '../lib/adapters.js';
import { loadCore } from '../lib/core.js';
import type { ToolDeps } from '../lib/deps.js';
import { FORMAT_NAMES } from '../lib/schema.js';
import { buildCatalog, formatSchemas } from '../tools/discover.js';
import {
  blockReferenceCatalog,
  BLOCK_REFERENCE_GUIDANCE,
} from '../templates/blocks.js';
import {
  galleryDocument,
  galleryManifests,
  galleryThumbnail,
} from '../templates/gallery.js';

export const RESOURCE_URIS = {
  catalog: 'jto://catalog',
  renderers: 'jto://renderers',
  themes: 'jto://themes',
  themeValues: 'jto://themes/values',
  templates: 'jto://templates',
  blocks: 'jto://blocks',
  blueprints: 'jto://blueprints',
  template: (name: string) => `jto://templates/${name}`,
  templateThumbnail: (name: string) => `jto://templates/${name}/thumbnail`,
  documentSchema: (format: FormatName) => `jto://schema/${format}/document`,
  themeSchema: (format: FormatName) => `jto://schema/${format}/theme`,
} as const;

const JSON_MIME = 'application/json';

/**
 * Compact, deliberately — indentation is not free at this size.
 *
 * The DOCX document schema is 3.3 MB of JSON; pretty-printed it was 12.8 MB,
 * and both ends of the stock stdio transport cap a frame at 10 MB. Reading
 * that resource therefore tore the connection down on any client using the
 * defaults, which `stdio-resources.test.ts` now covers. Whitespace is the
 * client's to add back if it wants to show the body to a human.
 */
function jsonContents(uri: URL, body: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: JSON_MIME,
        text: JSON.stringify(body),
      },
    ],
  };
}

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerResource(
    'blocks',
    RESOURCE_URIS.blocks,
    {
      title: 'JSON block authoring references',
      description: BLOCK_REFERENCE_GUIDANCE,
      mimeType: JSON_MIME,
    },
    async (uri) =>
      jsonContents(uri, {
        purpose: 'authoring-reference',
        guidance: BLOCK_REFERENCE_GUIDANCE,
        blocks: blockReferenceCatalog(),
      })
  );
  server.registerResource(
    'blueprints',
    RESOURCE_URIS.blueprints,
    {
      title: 'Blueprints',
      description:
        'Document archetypes as data, in full: recommended theme, quality profile, the bundled template whose blocks each invokes, and every structural variant with its sections, block invocations and {{…}} slot markers. jto_discover carries the summaries; jto_scaffold instantiates one into a draft workspace.',
      mimeType: JSON_MIME,
    },
    async (uri) =>
      jsonContents(uri, {
        formats: await Promise.all(
          FORMAT_NAMES.map(async (format) => ({
            format,
            blueprints: Object.values(
              (await loadCore(format))?.blueprints ?? {}
            )
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id)),
          }))
        ),
      })
  );
  server.registerResource(
    'catalog',
    RESOURCE_URIS.catalog,
    {
      title: 'Component catalogue',
      description:
        'Every format, its components with categories and allowed children, its renderer profiles, its built-in themes and its starter documents. The resource form of jto_discover.',
      mimeType: JSON_MIME,
    },
    async (uri) => jsonContents(uri, await buildCatalog(deps))
  );

  server.registerResource(
    'renderers',
    RESOURCE_URIS.renderers,
    {
      title: 'Renderer profiles',
      description:
        'Renderer ids per format, which is the default, and which components each profile accepts or cannot draw.',
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const catalog = await buildCatalog(deps);
      return jsonContents(uri, {
        formats: catalog.formats.map((format) => ({
          format: format.name,
          defaultRenderer: format.defaultRenderer,
          renderers: format.renderers,
        })),
      });
    }
  );

  server.registerResource(
    'themes',
    RESOURCE_URIS.themes,
    {
      title: 'Built-in themes',
      description:
        'Theme names shipped with each format, usable as a document’s props.theme or as the tools’ theme option. jto://themes/values carries what each name actually looks like.',
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const catalog = await buildCatalog(deps);
      return jsonContents(uri, {
        formats: catalog.formats.map((format) => ({
          format: format.name,
          themes: format.themes,
        })),
      });
    }
  );

  server.registerResource(
    'theme-values',
    RESOURCE_URIS.themeValues,
    {
      title: 'Built-in theme values',
      description:
        'The palette, fonts, style tables and component defaults behind every built-in theme name — what a document actually opts into with props.theme. A name alone cannot tell you whether a theme fits the brief; this can.',
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const formats = await Promise.all(
        FORMAT_NAMES.map(async (format) => {
          const adapter = deps.getAdapter(format);
          let themes;
          try {
            themes = adapter.getBuiltinThemeValues
              ? await adapter.getBuiltinThemeValues()
              : adapter.getBuiltinThemes();
          } catch {
            themes = adapter.getBuiltinThemes();
          }
          return {
            format,
            themes,
          };
        })
      );
      return jsonContents(uri, { formats });
    }
  );

  server.registerResource(
    'templates',
    RESOURCE_URIS.templates,
    {
      title: 'Starter documents and the template gallery',
      description:
        'Two kinds of starting point: tiny valid documents to copy and edit, and the manifests of the nine designed templates bundled with this package. Read jto://templates/<name> for a template document and jto://templates/<name>/thumbnail to see it first.',
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const catalog = await buildCatalog(deps);
      return jsonContents(uri, {
        starters: catalog.formats.flatMap((format) => format.starters),
        gallery: galleryManifests(),
      });
    }
  );

  // One pair of resources per bundled template. Registered individually rather
  // than as a URI template so `resources/list` shows a client every document it
  // can open, with its own title and description — a template shape would list
  // one entry and leave the names to be guessed.
  for (const manifest of galleryManifests()) {
    server.registerResource(
      `template-${manifest.name}`,
      RESOURCE_URIS.template(manifest.name),
      {
        title: manifest.name,
        description: `${manifest.archetype}, ${manifest.pages} ${
          manifest.format === 'pptx' ? 'slides' : 'pages'
        }, theme "${manifest.theme}". ${manifest.whenToUse}`,
        mimeType: JSON_MIME,
      },
      async (uri) => {
        const document = galleryDocument(manifest.name);
        if (document === undefined) {
          throw new Error(
            `The bundled document for "${manifest.name}" could not be read.`
          );
        }
        return jsonContents(uri, document);
      }
    );

    server.registerResource(
      `template-thumbnail-${manifest.name}`,
      RESOURCE_URIS.templateThumbnail(manifest.name),
      {
        title: `${manifest.name} (thumbnail)`,
        description: `Every page of ${manifest.name} tiled into one low-DPI image — look before copying ${Math.round(manifest.bytes.document / 1024)} KB of JSON.`,
        mimeType: 'image/png',
      },
      async (uri) => {
        const png = galleryThumbnail(manifest.name);
        if (png === undefined) {
          throw new Error(
            `The thumbnail for "${manifest.name}" could not be read.`
          );
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'image/png',
              blob: png.toString('base64'),
            },
          ],
        };
      }
    );
  }

  for (const format of FORMAT_NAMES) {
    server.registerResource(
      `${format}-document-schema`,
      RESOURCE_URIS.documentSchema(format),
      {
        title: `${format.toUpperCase()} document schema`,
        description: `Generated JSON Schema for a complete .${format} document, discriminated by renderer. Large (megabytes) — prefer jto_describe_component unless you need the whole thing.`,
        mimeType: JSON_MIME,
      },
      async (uri) => jsonContents(uri, formatSchemas(format).document)
    );

    server.registerResource(
      `${format}-theme-schema`,
      RESOURCE_URIS.themeSchema(format),
      {
        title: `${format.toUpperCase()} theme schema`,
        description: `Generated JSON Schema for a .${format} theme file, as passed to the tools’ themePath option.`,
        mimeType: JSON_MIME,
      },
      async (uri) => jsonContents(uri, formatSchemas(format).theme)
    );
  }
}

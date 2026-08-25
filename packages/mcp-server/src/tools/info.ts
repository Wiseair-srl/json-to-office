/**
 * `jto_info` — what this server is and what it can do here.
 *
 * The first call an agent makes and, on a cold host, the only one that answers
 * "will preview work at all". Everything it reports is read from the packages
 * and the filesystem rather than restated, so it cannot claim a renderer or a
 * binary that is not actually there.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { constants as fsConstants } from 'fs';
import { createRequire } from 'module';

import type { McpServer } from '@modelcontextprotocol/server';

import type { ToolDeps } from '../lib/deps.js';
import { FORMAT_NAMES, S, outputSchema } from '../lib/schema.js';
import {
  ERROR_CODES,
  diagnostic,
  guarded,
  success,
  toolResult,
  type Diagnostic,
} from '../lib/errors.js';
import { PACKAGE_NAME } from '../lib/version.js';

const require = createRequire(import.meta.url);

/**
 * Resolvers to try, in order.
 *
 * The cores are not our dependency — `jto-ops` owns them and imports them on
 * demand — so under pnpm's strict layout they are invisible from here. A
 * second resolver rooted at `jto-ops` sees exactly the copies it will load,
 * which is the version that actually decides what a render looks like.
 */
const resolvers: NodeJS.Require[] = [require];
try {
  // Rooted at `jto-ops`' manifest rather than its entry point: its `exports`
  // map declares `import` only, so a CJS `require.resolve` of the bare
  // specifier throws ERR_PACKAGE_PATH_NOT_EXPORTED. `./package.json` is
  // exported unconditionally and sits in the same directory.
  resolvers.push(
    createRequire(require.resolve('@json-to-office/jto-ops/package.json'))
  );
} catch {
  /* jto-ops unresolvable: the cores simply go unreported */
}

/** Workspace packages whose versions pin what a render actually is (#202). */
const REPORTED_PACKAGES = [
  '@json-to-office/jto-ops',
  '@json-to-office/shared',
  '@json-to-office/shared-docx',
  '@json-to-office/shared-pptx',
  '@json-to-office/core-docx',
  '@json-to-office/core-pptx',
] as const;

/**
 * Version of an installed package, or undefined.
 *
 * Two lookups per resolver because the packages disagree: `jto-ops` exports
 * `./package.json` explicitly, while `shared*` map `./*` onto `./dist/*` and
 * would resolve that subpath to a file that does not exist. Resolving the
 * entry point and walking up works for both.
 */
function readPackageVersion(specifier: string): string | undefined {
  for (const resolver of resolvers) {
    const candidates: string[] = [];
    try {
      candidates.push(resolver.resolve(`${specifier}/package.json`));
    } catch {
      /* not exported; fall through to the entry-point walk */
    }
    try {
      let dir = path.dirname(resolver.resolve(specifier));
      for (let depth = 0; depth < 8; depth += 1) {
        candidates.push(path.join(dir, 'package.json'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      /* not installed under this resolver */
    }
    for (const candidate of candidates) {
      try {
        const manifest = resolver(candidate) as {
          name?: string;
          version?: string;
        };
        if (
          manifest.name === specifier &&
          typeof manifest.version === 'string'
        ) {
          return manifest.version;
        }
      } catch {
        /* try the next candidate */
      }
    }
  }
  return undefined;
}

/** One renderer as `jto_info` reports it. */
interface RendererReport {
  id: string;
  default: boolean;
  available: boolean;
  reason?: string;
  installHint?: string;
}

export interface HostBinaryStatus {
  available: boolean;
  /** The candidate that satisfied the probe. */
  path?: string;
  /** Env var that overrides the search, so the agent can tell the user. */
  envVar: string;
  /** Everything that was looked at, in order. */
  searched: string[];
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a host binary without running it.
 *
 * `jto-ops` settles this by spawning `--version`, which is the right call
 * there — it is about to launch the thing anyway. Here it is not: `jto_info`
 * is a discovery call an agent may make on every connection, and a cold
 * `soffice --version` costs about a second. A PATH walk answers the same
 * question for the same money as a stat, at the cost of not catching a binary
 * that exists but is broken; a real preview run still reports that (#205).
 */
export async function probeBinary(
  candidates: string[],
  envVar: string
): Promise<HostBinaryStatus> {
  const searched: string[] = [];
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : [''];

  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      searched.push(candidate);
      if (await isExecutable(candidate)) {
        return { available: true, path: candidate, envVar, searched };
      }
      continue;
    }
    for (const entry of pathEntries) {
      if (!entry) continue;
      for (const extension of extensions) {
        const full = path.join(entry, candidate + extension);
        searched.push(full);
        if (await isExecutable(full)) {
          return { available: true, path: full, envVar, searched };
        }
      }
    }
  }
  return { available: false, envVar, searched };
}

/**
 * Candidate lists mirroring `jto-ops`' rasterizer.
 *
 * Duplicated rather than imported because the rasterizer keeps its resolution
 * private and spawn-based; if the two ever disagree the rasterizer wins, and
 * `jto_info` under-reports rather than promising a preview that then fails.
 */
export function sofficeCandidates(): string[] {
  const candidates: string[] = [];
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  if (configured) candidates.push(configured);
  if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    candidates.push(
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    );
  }
  candidates.push('soffice', 'libreoffice');
  return [...new Set(candidates)];
}

export function pdftoppmCandidates(): string[] {
  const configured = process.env.PDFTOPPM_PATH?.trim();
  return [...new Set([...(configured ? [configured] : []), 'pdftoppm'])];
}

/** Where `core-docx` posts a `highcharts` component when nothing overrides it. */
const DEFAULT_HIGHCHARTS_URL = 'http://localhost:7801';

/** How long a service is given to answer before it counts as absent. */
const SERVICE_PROBE_TIMEOUT_MS = 1500;

export interface ServiceStatus {
  available: boolean;
  /** The URL that was probed — the configured one, or the built-in default. */
  url: string;
  /** Env var that overrides it, so the agent can tell the user. */
  envVar: string;
  /** Why the probe failed, when it did. */
  detail?: string;
}

/** The URL a `highcharts` component will actually be posted to on this host. */
export function highchartsServerUrl(): string {
  const configured = process.env.HIGHCHARTS_SERVER_URL?.trim();
  return configured ? configured : DEFAULT_HIGHCHARTS_URL;
}

/**
 * Is anything listening where the chart service is expected?
 *
 * A TCP connect rather than an HTTP request: the export server has no health
 * endpoint this can rely on, and "something answers on that port" is the whole
 * question — a wrong path or a 404 would say nothing useful. The timeout is
 * short because `jto_info` is the call an agent makes first and may make on
 * every connection.
 *
 * The alternative is what happens today: an agent authors a DOCX with two
 * charts, validates clean, and only learns at generation that the render needed
 * a service nobody mentioned.
 */
export async function probeService(
  rawUrl: string,
  envVar: string
): Promise<ServiceStatus> {
  let target: URL;
  try {
    target = new URL(
      /^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`
    );
  } catch {
    return {
      available: false,
      url: rawUrl,
      envVar,
      detail: 'Not a URL.',
    };
  }

  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const net = await import('net');
  return new Promise<ServiceStatus>((resolve) => {
    const socket = net.connect({ host: target.hostname, port });
    const settle = (detail?: string): void => {
      socket.destroy();
      resolve({
        available: detail === undefined,
        url: target.origin,
        envVar,
        ...(detail !== undefined && { detail }),
      });
    };
    socket.setTimeout(SERVICE_PROBE_TIMEOUT_MS);
    socket.once('connect', () => settle());
    socket.once('timeout', () => settle('No answer within the probe timeout.'));
    socket.once('error', (error: Error) => settle(error.message));
  });
}

const binaryStatusSchema = {
  type: 'object' as const,
  properties: {
    available: { type: 'boolean' as const },
    path: { type: 'string' as const },
    envVar: { type: 'string' as const },
    searched: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['available', 'envVar', 'searched'],
  additionalProperties: false,
};

const serviceStatusSchema = {
  type: 'object' as const,
  properties: {
    available: { type: 'boolean' as const },
    url: { type: 'string' as const },
    envVar: { type: 'string' as const },
    detail: { type: 'string' as const },
  },
  required: ['available', 'url', 'envVar'],
  additionalProperties: false,
};

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_info',
    {
      title: 'Server info',
      description:
        'Versions, supported formats with each renderer and whether its backend loads here, workspace availability, output-root and size limits, and whether the optional host dependencies (LibreOffice and poppler for jto_preview, a Highcharts export server for the DOCX `highcharts` component) are present on this host. Call this first.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<{ includePreviewDependencies?: boolean }>({
        type: 'object',
        properties: {
          includePreviewDependencies: {
            type: 'boolean',
            description:
              'Probe the host for LibreOffice, poppler and the Highcharts export server. Default true.',
          },
        },
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema(
          {
            server: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                package: { type: 'string' },
                version: { type: 'string' },
                protocolTransport: { type: 'string' },
              },
              required: ['name', 'package', 'version'],
              additionalProperties: false,
            },
            runtime: {
              type: 'object',
              properties: {
                node: { type: 'string' },
                platform: { type: 'string' },
                arch: { type: 'string' },
              },
              required: ['node', 'platform', 'arch'],
              additionalProperties: false,
            },
            packages: {
              type: 'object',
              description:
                'Installed versions of the generation packages. A render is a function of the document plus these.',
              additionalProperties: { type: 'string' },
            },
            formats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  extension: { type: 'string' },
                  label: { type: 'string' },
                  rendererIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Defaults first. Registered, which is not the same as usable — read `renderers` before picking one.',
                  },
                  renderers: {
                    type: 'array',
                    description:
                      'Every registered renderer with whether its backend loads on this host. A renderer with `available: false` will fail every render until `installHint` is run.',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        default: { type: 'boolean' },
                        available: { type: 'boolean' },
                        reason: { type: 'string' },
                        installHint: { type: 'string' },
                      },
                      required: ['id', 'default', 'available'],
                      additionalProperties: false,
                    },
                  },
                },
                required: [
                  'name',
                  'extension',
                  'label',
                  'rendererIds',
                  'renderers',
                ],
                additionalProperties: false,
              },
            },
            workspaces: {
              type: 'object',
              properties: {
                available: { type: 'boolean' },
                open: { type: 'integer' },
              },
              required: ['available', 'open'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: {
                root: { type: 'string' },
                ephemeral: { type: 'boolean' },
                maxInlineArtifactBytes: { type: 'integer' },
              },
              required: ['root', 'ephemeral', 'maxInlineArtifactBytes'],
              additionalProperties: false,
            },
            previewDependencies: {
              type: 'object',
              description:
                'Optional host dependencies, absent when not probed. `libreoffice` and `pdftoppm` must BOTH be available for jto_preview to render; `highchartsExportServer` is needed by the DOCX `highcharts` component in any render, preview or not.',
              properties: {
                libreoffice: binaryStatusSchema,
                pdftoppm: binaryStatusSchema,
                highchartsExportServer: serviceStatusSchema,
              },
              required: ['libreoffice', 'pdftoppm', 'highchartsExportServer'],
              additionalProperties: false,
            },
          },
          // Only the envelope is required, as on every other tool. The SDK
          // validates outgoing `structuredContent` against this schema and
          // discards a result that does not match in favour of an isError
          // blob — so requiring the success fields would make the one case
          // that most needs reporting, an internal failure carrying nothing
          // but diagnostics, the one case an agent cannot read.
          []
        )
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const diagnostics: Diagnostic[] = [];

          const packages: Record<string, string> = {};
          for (const name of REPORTED_PACKAGES) {
            const version = readPackageVersion(name);
            if (version) packages[name] = version;
          }

          const formats = await Promise.all(
            FORMAT_NAMES.map(async (name) => {
              const adapter = deps.getAdapter(name);
              let renderers: RendererReport[] = [];
              try {
                // Statuses rather than ids: an id says a renderer is
                // registered, which is a claim about this repository, not
                // about this host. #1 was exactly that gap — `office-open`
                // advertised everywhere and installed nowhere.
                renderers = (await adapter.rendererStatuses()).map(
                  (status) => ({
                    id: status.id,
                    default: status.default,
                    available: status.available,
                    ...(status.reason !== undefined && {
                      reason: status.reason,
                    }),
                    ...(status.installHint !== undefined && {
                      installHint: status.installHint,
                    }),
                  })
                );
              } catch (error) {
                // A core that fails to load is a broken install, not a broken
                // request: report the format with no renderers so the agent
                // can still see the rest of the picture.
                diagnostics.push(
                  diagnostic(
                    ERROR_CODES.DEPENDENCY_MISSING,
                    `Could not read renderer ids for ${name}: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                    { severity: 'warning', context: { format: name } }
                  )
                );
              }

              for (const renderer of renderers) {
                if (renderer.available) continue;
                diagnostics.push(
                  diagnostic(
                    ERROR_CODES.DEPENDENCY_MISSING,
                    `The "${renderer.id}" ${name} renderer is registered but cannot load on this host, so every render through it will fail.`,
                    {
                      severity: 'warning',
                      ...(renderer.installHint && {
                        suggestion: `Install its backend: ${renderer.installHint}. Until then use one of: ${renderers
                          .filter((entry) => entry.available)
                          .map((entry) => `"${entry.id}"`)
                          .join(', ')}.`,
                      }),
                      context: {
                        format: name,
                        renderer: renderer.id,
                        ...(renderer.reason && { reason: renderer.reason }),
                      },
                    }
                  )
                );
              }

              return {
                name: adapter.name,
                extension: adapter.extension,
                label: adapter.label,
                rendererIds: renderers.map((renderer) => renderer.id),
                renderers,
              };
            })
          );

          const store = deps.workspaces();
          const listed = await store.list();

          const includePreview = args.includePreviewDependencies !== false;
          const previewDependencies = includePreview
            ? {
                libreoffice: await probeBinary(
                  sofficeCandidates(),
                  'LIBREOFFICE_PATH'
                ),
                pdftoppm: await probeBinary(
                  pdftoppmCandidates(),
                  'PDFTOPPM_PATH'
                ),
                highchartsExportServer: await probeService(
                  highchartsServerUrl(),
                  'HIGHCHARTS_SERVER_URL'
                ),
              }
            : undefined;

          if (
            previewDependencies &&
            (!previewDependencies.libreoffice.available ||
              !previewDependencies.pdftoppm.available)
          ) {
            diagnostics.push(
              diagnostic(
                ERROR_CODES.DEPENDENCY_MISSING,
                'Preview needs both LibreOffice and poppler (pdftoppm); at least one is missing on this host.',
                {
                  severity: 'info',
                  suggestion:
                    'Install LibreOffice and poppler-utils, or set LIBREOFFICE_PATH / PDFTOPPM_PATH. Validation, generation and diff do not need them.',
                }
              )
            );
          }

          // Its own diagnostic, not folded into the preview one: this service
          // gates a COMPONENT rather than a tool, so an agent about to author a
          // DOCX chart needs to read it even on a host where preview works.
          if (
            previewDependencies &&
            !previewDependencies.highchartsExportServer.available
          ) {
            diagnostics.push(
              diagnostic(
                ERROR_CODES.DEPENDENCY_MISSING,
                `No Highcharts export server is answering at ${previewDependencies.highchartsExportServer.url}; the DOCX \`highcharts\` component cannot render here.`,
                {
                  severity: 'info',
                  suggestion:
                    'Start it with `npx highcharts-export-server --enableServer true`, or point HIGHCHARTS_SERVER_URL at a running one. The `visual` component draws charts with no external service.',
                  context: {
                    dependency: 'highchartsExportServer',
                    component: 'highcharts',
                  },
                }
              )
            );
          }

          return success(
            {
              server: {
                name: 'json-to-office',
                package: PACKAGE_NAME,
                version: deps.serverVersion,
                protocolTransport: 'stdio',
              },
              runtime: {
                node: process.versions.node,
                platform: process.platform,
                arch: process.arch,
              },
              packages,
              formats,
              workspaces: {
                available: store.available,
                open: listed.ok ? listed.records.length : 0,
              },
              output: {
                root: deps.outputRoot.path,
                ephemeral: deps.outputRoot.ephemeral,
                maxInlineArtifactBytes: deps.maxInlineArtifactBytes,
              },
              ...(previewDependencies && { previewDependencies }),
            },
            diagnostics
          );
        })
      )
  );
}

/**
 * Tool schemas, authored as plain JSON Schema.
 *
 * `fromJsonSchema` wraps a JSON Schema in the Standard Schema shape the SDK
 * validates against, and passes the schema itself through to `tools/list`
 * verbatim. Authoring JSON Schema directly therefore keeps zod out of our own
 * source and guarantees that what an agent discovers is exactly what the
 * server enforces — no conversion step in between to drift.
 */

import { fromJsonSchema } from '@modelcontextprotocol/server';
import type {
  JsonSchemaType,
  StandardSchemaWithJSON,
  jsonSchemaValidator,
} from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';

import type { FormatName } from './adapters.js';

/**
 * One validator for every schema in the process.
 *
 * Ajv compiles and caches per schema; a fresh instance per tool would pay that
 * cost again and hold a second copy of every compiled validator for the life
 * of the connection.
 */
const validator: jsonSchemaValidator = new AjvJsonSchemaValidator();

/**
 * Wrap a JSON Schema for `registerTool`.
 *
 * The type parameter is the handler's view of the validated value — the SDK
 * infers callback arguments from it and cannot derive it from a runtime schema
 * object, so pass it explicitly: `S<{ format: FormatName }>({ … })`.
 */
export function S<T = unknown>(
  schema: JsonSchemaType
): StandardSchemaWithJSON<T, T> {
  return fromJsonSchema<T>(schema, validator);
}

/** Every format this server can author. */
export const FORMAT_NAMES: readonly FormatName[] = ['docx', 'pptx'];

export const formatSchema: JsonSchemaType = {
  type: 'string',
  enum: [...FORMAT_NAMES],
  description: 'Office format to operate on.',
};

/**
 * The document a tool operates on: inline JSON, or a workspace reference.
 *
 * Both are spelled out on every document-taking tool rather than hidden behind
 * a `oneOf`, because a discovering agent reads the flat property list and many
 * clients render nothing else. `doc-source.ts` enforces the exclusivity that
 * the schema deliberately does not.
 */
export const documentSourceProperties: Record<string, JsonSchemaType> = {
  document: {
    type: 'object',
    description:
      'The document JSON, inline. Mutually exclusive with `handle`. This is the portable baseline: it needs no prior state.',
    additionalProperties: true,
  },
  handle: {
    type: 'string',
    description:
      'Opaque handle of an open workspace document (from jto_workspace_create). Mutually exclusive with `document`.',
    minLength: 1,
  },
  revision: {
    type: 'integer',
    description:
      'Revision the caller believes `handle` is at. When given and stale, the call fails instead of silently operating on newer JSON.',
    minimum: 1,
  },
};

/** Human-readable restatement of the rule the schema cannot express. */
export const DOCUMENT_SOURCE_RULE =
  'Supply exactly one of `document` (inline JSON) or `handle` (an open workspace).';

/**
 * Renderer, theme and determinism knobs, mirroring `GeneratorOptions` from
 * `@json-to-office/jto-ops`. Shared verbatim by validate/generate/preview/diff
 * so the same document renders the same way whichever tool an agent reaches
 * for.
 */
export const renderOptionProperties: Record<string, JsonSchemaType> = {
  renderer: {
    type: 'string',
    description:
      'Renderer id for this format (see jto_info.formats[].rendererIds). Omit for the format default.',
  },
  theme: {
    type: 'string',
    description:
      "Built-in or custom theme name. Omit to keep each document's own `props.theme`.",
  },
  themePath: {
    type: 'string',
    description:
      'Path to a data-only JSON theme file, resolved against `baseDir` (or the server working directory when `baseDir` is omitted). Executable theme modules are not accepted over MCP.',
  },
  deterministic: {
    type: 'boolean',
    description:
      'Strip nondeterministic metadata (timestamps, ids) so identical JSON yields byte-identical output.',
  },
  generatedAt: {
    type: 'string',
    description:
      'ISO 8601 instant to stamp instead of "now"; pairs with `deterministic`.',
  },
  baseDir: {
    type: 'string',
    description:
      'Directory that relative asset paths in the document resolve against.',
  },
};

/** How a generated file comes back: written to disk, or inline. */
export const artifactOutputProperties: Record<string, JsonSchemaType> = {
  outputMode: {
    type: 'string',
    enum: ['path', 'base64'],
    description:
      '`path` (default) writes under the server output root and returns the path. `base64` inlines the bytes and is refused — never silently downgraded — above the inline size limit (see jto_info.output.maxInlineArtifactBytes).',
  },
  filename: {
    type: 'string',
    description:
      'File name for the artifact, relative to the output root. Must not escape it: no absolute paths, no `..`.',
  },
};

export const diagnosticSchema: JsonSchemaType = {
  type: 'object',
  description: 'One machine-actionable defect.',
  properties: {
    severity: { type: 'string', enum: ['error', 'warning', 'info'] },
    code: {
      type: 'string',
      description: 'Stable machine code, e.g. E_INVALID_DOCUMENT.',
    },
    message: { type: 'string' },
    path: {
      type: 'string',
      description: 'RFC 6901 JSON Pointer into the document, when located.',
    },
    suggestion: { type: 'string' },
    context: { type: 'object', additionalProperties: true },
  },
  required: ['severity', 'code', 'message'],
  additionalProperties: true,
};

export const diagnosticsSchema: JsonSchemaType = {
  type: 'array',
  description:
    'Always present, possibly empty. Document defects arrive here, never as a protocol error.',
  items: diagnosticSchema,
};

/** The `{ ok, diagnostics }` floor every tool output schema builds on. */
export const envelopeProperties: Record<string, JsonSchemaType> = {
  ok: { type: 'boolean' },
  diagnostics: diagnosticsSchema,
};

/**
 * A delivered file, exactly as `deliverArtifact` returns one.
 *
 * `relative` is not decoration: the SDK validates outgoing
 * `structuredContent` against the declared schema, and this object closes
 * `additionalProperties`, so omitting a field every path-mode artifact
 * carries would turn each successful generation into an output-validation
 * error. Generate, diff, preview and snapshot all report through this one
 * definition.
 */
export const artifactSchema: JsonSchemaType = {
  type: 'object',
  description: 'A generated file, delivered by path or inline.',
  properties: {
    mode: { type: 'string', enum: ['path', 'base64'] },
    path: {
      type: 'string',
      description:
        'Absolute path under the output root. Present when mode=path.',
    },
    relative: {
      type: 'string',
      description:
        'Path relative to the output root, for display. Present when mode=path.',
    },
    base64: {
      type: 'string',
      description: 'File bytes, base64. Present when mode=base64.',
    },
    bytes: { type: 'integer', description: 'Decoded size in bytes.' },
    filename: { type: 'string' },
    mimeType: { type: 'string' },
  },
  required: ['mode', 'bytes', 'filename', 'mimeType'],
  additionalProperties: false,
};

/**
 * `documentSourceProperties` as one nested object.
 *
 * A tool that takes two documents cannot spell them both flat — `jto_docx_diff`
 * would need two `document` keys — so `before`/`after` each carry a bag of
 * this shape. Single-document tools stay flat, which is what an agent reading
 * a property list expects.
 */
export const documentSourceSchema: JsonSchemaType = {
  type: 'object',
  properties: documentSourceProperties,
  additionalProperties: false,
};

/** Where a tool actually read its document from, echoed back to the caller. */
export const sourceSummarySchema: JsonSchemaType = {
  type: 'object',
  description: 'Where the document was read from.',
  properties: {
    origin: { type: 'string', enum: ['inline', 'workspace'] },
    handle: { type: 'string' },
    revision: {
      type: 'integer',
      description: 'The revision actually read, which may be a pinned one.',
    },
  },
  required: ['origin'],
  additionalProperties: false,
};

/** Compose an output schema from the standard envelope plus tool-specific fields. */
export function outputSchema(
  properties: Record<string, JsonSchemaType>,
  required: readonly string[] = []
): JsonSchemaType {
  return {
    type: 'object',
    properties: { ...envelopeProperties, ...properties },
    required: ['ok', 'diagnostics', ...required],
    additionalProperties: true,
  };
}

/** The inline/handle pair, as the tool handlers see it after validation. */
export interface DocumentSourceInput {
  document?: unknown;
  handle?: string;
  revision?: number;
}

/** `sourceSummarySchema`, as the tools report it. */
export interface SourceSummary {
  origin: 'inline' | 'workspace';
  handle?: string;
  revision?: number;
}

/** `renderOptionProperties`, as the tool handlers see it after validation. */
export interface RenderOptionsInput {
  renderer?: string;
  theme?: string;
  themePath?: string;
  deterministic?: boolean;
  generatedAt?: string;
  baseDir?: string;
}

/** `artifactOutputProperties`, as the tool handlers see it after validation. */
export interface ArtifactOutputInput {
  outputMode?: 'path' | 'base64';
  filename?: string;
}

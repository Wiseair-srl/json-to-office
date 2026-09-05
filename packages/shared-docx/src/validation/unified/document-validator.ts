/**
 * Document validation implementation
 * Single source of truth for all document validation
 */

import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ComponentDefinitionSchema,
  StandardComponentDefinitionSchema,
} from '../../schemas/components';
import {
  createComponentSchemaObject,
  STANDARD_COMPONENTS_REGISTRY,
} from '../../schemas/component-registry';
import { extractStandardComponentNames } from '@json-to-office/shared';
import {
  comprehensiveValidateDocument,
  collectImageSourceConflicts,
  collectChromeBlockPlacement,
  collectIndentConflicts,
  collectNoteRevisionConflicts,
  collectTextBoxShapeConflicts,
} from './deep-validator';

// JsonComponentDefinitionSchema is just an alias for ComponentDefinitionSchema
const JsonComponentDefinitionSchema = ComponentDefinitionSchema;
import type {
  DocumentValidationResult,
  ValidationError,
  ValidationOptions,
} from './types';
import { validateAgainstSchema, validateJson } from './base-validator';
import { collectDocxRendererErrors } from '../../schemas/renderer';

/**
 * The semantic rules the structural schema cannot express.
 *
 * Each entry runs unconditionally over the whole document, because every one of
 * them describes a payload TypeBox already accepted: the fields involved are
 * independently optional, and only their combination is wrong.
 *
 * They live in one list because both entry points below need all of them, and a
 * collector wired into only one of the two is invisible until a document takes
 * the other path.
 */
const SEMANTIC_COLLECTORS: readonly {
  readonly why: string;
  readonly collect: (document: unknown) => ValidationError[];
}[] = [
  {
    // A multi-source image passes the structural check: each source is its own
    // optional field.
    why: 'image source mutual-exclusivity',
    collect: collectImageSourceConflicts,
  },
  {
    // Header and column contents are structurally any component, so the
    // schema cannot say where page chrome may sit.
    why: 'a running-head outside a top-level section',
    collect: collectChromeBlockPlacement,
  },
  {
    why: 'indent hanging/firstLine mutual-exclusivity',
    collect: collectIndentConflicts,
  },
  {
    // Tracked-change text renders literally, so a note marker inside it never
    // resolves and docx cannot express the pair anyway.
    why: 'notes on a revised paragraph',
    collect: collectNoteRevisionConflicts,
  },
  {
    // A shape has no autofit and its outline carries no dash pattern, so the
    // request could only ever come back as a table.
    why: 'a text box asking for a shape rendering a shape cannot give it',
    collect: collectTextBoxShapeConflicts,
  },
  {
    why: 'renderer profile compatibility',
    collect: collectDocxRendererErrors,
  },
];

/**
 * Run every semantic rule over an already-resolved document — `data` for the
 * object entry point, `result.parsed` for the JSON one.
 */
function collectSemanticConflicts(document: unknown): ValidationError[] {
  return SEMANTIC_COLLECTORS.flatMap(({ collect }) => collect(document));
}

/** True when any node anywhere in the tree is a registered plugin component. */
function referencesCustomComponent(node: unknown, names: Set<string>): boolean {
  if (Array.isArray(node)) {
    return node.some((item) => referencesCustomComponent(item, names));
  }
  if (!node || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  if (typeof record.name === 'string' && names.has(record.name)) return true;
  return Object.values(record).some((value) =>
    referencesCustomComponent(value, names)
  );
}

/**
 * The whole-document schema with every container's children relaxed to the
 * full component union — and ONLY the children.
 *
 * Stage 1 narrows each container to its registry `allowedChildren` (docx →
 * section only, …) as authoring guidance, but the pipeline accepts and renders
 * looser nesting — a heading directly under the root is a pinned behavior. A
 * document that fails stage 1 but passes this schema failed on containment
 * alone.
 *
 * The recursive ref is passed as BOTH the children union and the props
 * factories' `selfRef`, so embedded regions (section header/footer, table
 * cell content) keep their live component typing here. Passing it only as
 * children once left those factories on the static schemas, whose regions are
 * `Type.Any()` — the gate then also relaxed embedded-region typing and
 * re-admitted a wrong-typed sibling key inside a header. Built lazily: only
 * the empty-walk path below ever needs it.
 */
let containmentRelaxedSchema: TSchema | undefined;
function getContainmentRelaxedSchema(): TSchema {
  containmentRelaxedSchema ??= Type.Recursive((This) =>
    Type.Union(
      STANDARD_COMPONENTS_REGISTRY.map((component) =>
        createComponentSchemaObject(component, This, This)
      )
    )
  );
  return containmentRelaxedSchema;
}

/**
 * Decide a document that failed stage 1 (the whole-document TypeBox check)
 * while the deep walk found nothing actionable.
 *
 * Stage 1 has exactly three known false-reject classes, each handled by one
 * gate below:
 *
 *  - `allowUnknownFields` — the whole-document schema is
 *    additionalProperties:false throughout, so the unknown keys the caller
 *    asked to tolerate always fail it. The deep walk has already re-checked
 *    every component with unknown props stripped, so its empty result is the
 *    leniency working as designed. Residual risk, documented: under this
 *    option a walk blind spot is still invisible — the caller opted into
 *    unknown content being ignored.
 *  - registered plugin components (`knownCustomNames`) — the static document
 *    schema has no plugin branch, so a document that uses one always fails
 *    stage 1. The walk skipped those nodes for the plugin layer to validate
 *    version-aware. Applies only when the document actually uses a registered
 *    name; registering plugins must not loosen validation of documents that
 *    never mention them. Residual risk, documented: in a document that does
 *    use one, leniency and a walk blind spot cannot be told apart.
 *  - `allowedChildren` containment — stage 1 narrows container children as
 *    authoring guidance, but the pipeline accepts looser nesting (a heading
 *    directly under the root renders fine, and tests pin it). This gate is
 *    precise: the document must pass the containment-relaxed whole-document
 *    schema, so junk that stage 1 rejected for any other reason still fails.
 *
 * Otherwise the empty walk means a walk blind spot, and the document fails
 * CLOSED, keeping stage 1's own generic error. Historically this flipped to
 * valid instead (938bdda, when stage 1's false rejects were the rule), which
 * silently accepted invalid documents — e.g. an unknown key next to
 * `name`/`props`, a position no per-component props check ever sees (#292).
 */
function resolveEmptyWalk(
  document: unknown,
  stageOneErrors: ValidationError[],
  options?: ValidationOptions
): { valid: boolean; errors: ValidationError[] } {
  if (
    options?.allowUnknownFields === true ||
    (options?.knownCustomNames !== undefined &&
      options.knownCustomNames.size > 0 &&
      referencesCustomComponent(document, options.knownCustomNames)) ||
    Value.Check(getContainmentRelaxedSchema(), document)
  ) {
    return { valid: true, errors: [] };
  }

  const errors =
    stageOneErrors.length > 0
      ? stageOneErrors
      : [
          {
            path: 'root',
            message: "Document does not match the 'docx' document schema.",
            code: 'invalid_document',
          },
        ];
  return {
    valid: false,
    errors: [
      ...errors,
      {
        path: 'root',
        message:
          'The document was rejected by the whole-document schema, but deep validation ' +
          'could not localize the fault. Common causes: an unknown key next to "name", ' +
          '"props" or "children" on some component, or a value at a position the ' +
          'schema does not declare.',
        code: 'unlocalized_schema_error',
      },
    ],
  };
}

/**
 * Stage 2 for a document stage 1 rejected: deep-walk it for path-addressed
 * errors; when the walk comes back empty, let resolveEmptyWalk decide between
 * the audited leniencies and failing closed. Shared by both entry points
 * below so the two cannot drift.
 */
function deepValidateRejected(
  document: unknown,
  stageOneErrors: ValidationError[],
  options?: ValidationOptions
): { valid: boolean; errors: ValidationError[] } {
  const errors = comprehensiveValidateDocument(document, stageOneErrors, {
    allowUnknownFields: options?.allowUnknownFields,
    knownCustomNames: options?.knownCustomNames,
  });
  if (errors.length === 0) {
    return resolveEmptyWalk(document, stageOneErrors, options);
  }
  return { valid: false, errors };
}

/**
 * Validate a document/report component definition
 */
export function validateDocument(
  data: unknown,
  options?: ValidationOptions
): DocumentValidationResult {
  const result = validateAgainstSchema(
    ComponentDefinitionSchema,
    data,
    options
  );

  // If validation failed, use deep validation to get all detailed errors
  let finalErrors = result.errors || [];
  let finalValid = result.valid;
  if (!result.valid && data) {
    ({ valid: finalValid, errors: finalErrors } = deepValidateRejected(
      data,
      result.errors || [],
      options
    ));
  }

  // Semantic rules run on every document, valid or not: they describe payloads
  // the structural check already accepted.
  const semanticConflicts = collectSemanticConflicts(data);
  if (semanticConflicts.length > 0) {
    finalErrors = [...finalErrors, ...semanticConflicts];
    finalValid = false;
  }

  // Add document-specific metadata. Keep `data` populated whenever `valid` is
  // true so `isValidDocument()` (which requires both) stays consistent — when
  // TypeBox failed and the deep validator cleared the doc, fall back to the
  // original input as the data payload.
  const resolvedData =
    result.data ??
    (finalValid
      ? (data as Static<typeof ComponentDefinitionSchema>)
      : undefined);
  const documentResult: DocumentValidationResult = {
    ...result,
    valid: finalValid,
    documentType: 'docx',
    errors: finalErrors,
    data: resolvedData,
  };

  // Check if document has custom components
  if (finalValid) {
    const doc = resolvedData as any;
    if (doc && doc.children && Array.isArray(doc.children)) {
      const hasCustom = doc.children.some(
        (c: any) => !isStandardComponentName(c.name)
      );
      documentResult.hasCustomComponents = hasCustom;
    }
  }

  return documentResult;
}

/**
 * Validate a JSON document (string or object)
 */
export function validateJsonDocument(
  jsonInput: string | object,
  options?: ValidationOptions
): DocumentValidationResult {
  // Use the JSON-specific schema which includes the $schema field
  const result = validateJson(
    JsonComponentDefinitionSchema,
    jsonInput,
    options
  );

  // If validation failed, use deep validation to get all detailed errors
  let finalErrors = result.errors || [];
  let finalValid = result.valid;
  if (!result.valid && result.parsed) {
    ({ valid: finalValid, errors: finalErrors } = deepValidateRejected(
      result.parsed,
      result.errors || [],
      options
    ));
  }

  // Semantic rules run on every document, valid or not: they describe payloads
  // the structural check already accepted.
  const semanticConflicts = collectSemanticConflicts(result.parsed);
  if (semanticConflicts.length > 0) {
    finalErrors = [...finalErrors, ...semanticConflicts];
    finalValid = false;
  }

  // Add document-specific metadata. Keep `data` populated whenever `valid` is
  // true so `isValidDocument()` (which requires both) stays consistent — when
  // TypeBox failed and the deep validator cleared the doc, fall back to the
  // parsed input as the data payload.
  const resolvedData =
    result.data ??
    (finalValid
      ? (result.parsed as Static<typeof ComponentDefinitionSchema>)
      : undefined);
  const documentResult: DocumentValidationResult = {
    ...result,
    valid: finalValid,
    documentType: 'docx',
    errors: finalErrors,
    data: resolvedData,
  };

  // Check for custom components
  if (finalValid) {
    const doc = resolvedData as any;
    if (doc && doc.children && Array.isArray(doc.children)) {
      const hasCustom = doc.children.some(
        (c: any) => !isStandardComponentName(c.name)
      );
      documentResult.hasCustomComponents = hasCustom;
    }
  }

  return documentResult;
}

/**
 * Type guard for document validation result
 */
export function isValidDocument(
  result: DocumentValidationResult
): result is DocumentValidationResult & {
  valid: true;
  data: Static<typeof ComponentDefinitionSchema>;
} {
  return result.valid === true && result.data !== undefined;
}

/**
 * Extract standard component names from the schema (cached)
 */
function getStandardComponentNames(): string[] {
  return extractStandardComponentNames(StandardComponentDefinitionSchema);
}

/**
 * Check if a component name is standard
 */
function isStandardComponentName(name: string): boolean {
  const standardNames = getStandardComponentNames();
  return standardNames.includes(name);
}

/**
 * Create a document validator with default options
 */
export function createDocumentValidator(defaultOptions?: ValidationOptions) {
  return {
    validate: (data: unknown, options?: ValidationOptions) =>
      validateDocument(data, { ...defaultOptions, ...options }),
    validateJson: (jsonInput: string | object, options?: ValidationOptions) =>
      validateJsonDocument(jsonInput, { ...defaultOptions, ...options }),
  };
}

// Export convenient validators with common configurations
export const documentValidator = createDocumentValidator({
  clean: true,
  applyDefaults: true,
  maxErrors: 100, // Collect up to 100 errors to show all validation issues
});

export const strictDocumentValidator = createDocumentValidator({
  clean: false,
  applyDefaults: false,
  maxErrors: 100, // Increased from 10 to show more errors
});

/**
 * Legacy compatibility exports
 */
export const validateJsonComponent = validateJsonDocument;
export const validateDocumentWithSchema = validateDocument;

import { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Context, Env, ValidationTargets, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Auto-detect raw document JSON (has `name` + `children` but no `jsonDefinition`)
 * and wrap it so callers can POST the document tree directly.
 */
function autoWrapDocumentBody(value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'children' in value &&
    !('jsonDefinition' in value)
  ) {
    return { jsonDefinition: value };
  }
  return value;
}

export function tbValidator<
  T extends TSchema,
  E extends Env = Env,
  P extends string = string,
>(schema: T) {
  return (async (c: Context<E, P>, next: () => Promise<void>) => {
    let value: unknown;

    try {
      value = await c.req.json();
    } catch {
      throw new HTTPException(400, {
        message: 'Invalid JSON in request body',
      });
    }

    value = autoWrapDocumentBody(value);

    const isValid = Value.Check(schema, value);

    if (isValid) {
      (c.req as { validatedData?: Record<string, unknown> }).validatedData = {
        json: value,
      };
      await next();
    } else {
      const errors = [...Value.Errors(schema, value)].map((error) => ({
        path: error.path,
        message: error.message,
        value: error.value,
      }));

      const errorMessages = errors.map((e) => `${e.path || '/'}: ${e.message}`);

      throw new HTTPException(400, {
        message:
          errorMessages.length === 1
            ? errorMessages[0]
            : `Validation failed:\n${errorMessages.join('\n')}`,
        cause: { errors },
      });
    }
  }) as MiddlewareHandler<E, P, Record<string, unknown>>;
}

export function getValidated<T>(
  c: Context,
  target: keyof ValidationTargets
): T {
  const validatedData = (c.req as { validatedData?: Record<string, unknown> })
    .validatedData;
  if (!validatedData || !validatedData[target]) {
    throw new Error(`No validated data found for target: ${target}`);
  }
  return validatedData[target] as T;
}

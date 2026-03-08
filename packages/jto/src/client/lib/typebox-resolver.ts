/**
 * TypeBox Resolver for React Hook Form
 * Provides validation integration between TypeBox schemas and React Hook Form
 */

import { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';

export type TypeBoxResolver = <T extends FieldValues>(
  schema: TSchema,
  customValidation?: (data: unknown) => {
    success: boolean;
    errors?: Array<{ path: string; message: string }>;
  }
) => Resolver<T>;

/**
 * Creates a React Hook Form resolver for TypeBox schemas
 * @param schema - The TypeBox schema to validate against
 * @param customValidation - Optional custom validation function for additional validations
 * @returns A resolver function compatible with React Hook Form
 */
export const typeboxResolver: TypeBoxResolver = <T extends FieldValues>(
  schema: TSchema,
  customValidation?: (data: unknown) => {
    success: boolean;
    errors?: Array<{ path: string; message: string }>;
  }
) => {
  return async (values: T) => {
    const errors: FieldErrors<T> = {} as FieldErrors<T>;

    // First validate against the TypeBox schema
    if (!Value.Check(schema, values)) {
      for (const error of Value.Errors(schema, values)) {
        const path = error.path.replace(/^\//, '').replace(/\//g, '.');
        const field = path || 'root';

        if (!errors[field]) {
          (errors as any)[field] = {
            type: 'validation',
            message: error.message,
          };
        }
      }
    }

    // Apply custom validations if provided
    if (customValidation) {
      const customResult = customValidation(values);
      if (!customResult.success && customResult.errors) {
        for (const error of customResult.errors) {
          const field = error.path || 'root';
          if (!errors[field]) {
            (errors as any)[field] = {
              type: 'custom',
              message: error.message,
            };
          }
        }
      }
    }

    return {
      values: Object.keys(errors).length === 0 ? values : ({} as T),
      errors,
    } as any;
  };
};

/**
 * Helper function to create a resolver with custom validation logic
 * This is useful when you need both schema validation and custom business logic
 */
export function createTypeBoxResolver<T extends FieldValues>(
  validationFunction: (data: unknown) => {
    success: boolean;
    data?: T;
    errors?: Array<{ path: string; message: string }>;
  }
): Resolver<T> {
  return async (values: T) => {
    const result = validationFunction(values);

    if (result.success && result.data) {
      return {
        values: result.data,
        errors: {} as FieldErrors<T>,
      } as any;
    }

    const errors: FieldErrors<T> = {} as FieldErrors<T>;
    if (result.errors) {
      for (const error of result.errors) {
        const field = error.path || 'root';
        if (!errors[field]) {
          (errors as any)[field] = {
            type: 'validation',
            message: error.message,
          };
        }
      }
    }

    return {
      values: {} as T,
      errors,
    } as any;
  };
}

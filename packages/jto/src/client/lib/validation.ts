import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Mode, TextFile } from './types';

export function isNewDocumentName(
  name: string,
  documents: TextFile[],
  skipName?: string
) {
  return documents
    .filter((doc) => doc.name !== skipName)
    .every((doc) => doc.name !== name);
}

// TypeBox schema builders for document forms
export function getDocumentFormSchema(
  mode: Mode,
  isNewDocumentNameFunc: (value: string) => boolean,
  templates?: TextFile[]
) {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  if (mode !== 'delete') {
    properties['name'] = Type.String({
      minLength: 1,
      maxLength: 120,
      // Allow dots so filenames like *.docx.json, *.pptx.json and *.theme.json are valid
      // Still restrict to a safe subset (alphanumerics, space, hyphen, underscore, dot)
      pattern: '^[a-zA-Z0-9-_. ]+$',
      description:
        'Document name (e.g., my-report.docx.json or my-theme.theme.json)',
    });
    required.push('name');
  }

  if (mode === 'create') {
    properties['template'] = Type.Optional(Type.String({
      description: 'Template selection',
    }));
  }

  // Create the base schema
  const schema = Type.Object(properties, {
    additionalProperties: false,
    required: required.length > 0 ? required : undefined,
  });

  // Return a validation function that includes custom validations
  return {
    schema,
    validate: (data: unknown) => {
      // First check basic TypeBox validation
      const errors: Array<{ path: string; message: string }> = [];

      if (!Value.Check(schema, data)) {
        for (const error of Value.Errors(schema, data)) {
          errors.push({
            path: error.path.replace(/^\//, ''),
            message: error.message,
          });
        }
      }

      // Apply custom validations
      const typedData = data as any;

      if (mode !== 'delete' && typedData.name) {
        // Trim validation
        const trimmed = typedData.name.trim();
        if (!trimmed) {
          errors.push({
            path: 'name',
            message: 'Name can\'t be empty',
          });
        } else {
          // Update the data with trimmed value
          typedData.name = trimmed;

          // Custom validation for duplicate names
          if (!isNewDocumentNameFunc(trimmed)) {
            errors.push({
              path: 'name',
              message: 'Document with this name already exists',
            });
          }
        }
      }

      if (mode === 'create' && templates?.length && typedData.template) {
        // Template validation
        if (!templates.some((t) => t.name === typedData.template)) {
          errors.push({
            path: 'template',
            message: 'You must select a valid template',
          });
        }
      }

      return {
        success: errors.length === 0,
        data: errors.length === 0 ? typedData : undefined,
        errors,
      };
    },
  };
}

// Type for the form data
export type DocumentFormData = {
  name?: string;
  template?: string;
};

export function getDocumentFormDefaultValues(
  mode: Mode,
  defaultTemplate?: string,
  selectedName?: string
): DocumentFormData {
  if (mode === 'create')
    return {
      name: '', // Start with empty string so user can see the prefilled name
      template: defaultTemplate,
    };
  if (mode === 'update') return { name: selectedName };
  return {};
}

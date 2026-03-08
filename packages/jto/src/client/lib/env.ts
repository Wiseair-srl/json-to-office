import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export type FormatName = 'docx' | 'pptx';

const EnvSchema = Type.Object({
  basePath: Type.String({ default: '' }),
});

type Env = Static<typeof EnvSchema>;

function validateAndTransformEnv(rawEnv: unknown): Env {
  const withDefaults = Value.Default(EnvSchema, rawEnv) as any;

  if (withDefaults.basePath && withDefaults.basePath !== '') {
    if (
      !withDefaults.basePath.startsWith('/') ||
      withDefaults.basePath.endsWith('/')
    ) {
      throw new Error('basePath must start with / and not end with /');
    }
  }

  if (!Value.Check(EnvSchema, withDefaults)) {
    const errors = [...Value.Errors(EnvSchema, withDefaults)];
    throw new Error(
      `Environment validation failed: ${errors.map((e) => e.message).join(', ')}`
    );
  }

  return withDefaults as Env;
}

export const env = validateAndTransformEnv({
  basePath: import.meta.env.VITE_BASE_PATH || '',
});

// Format injected by server via window.__JTO_FORMAT__
declare global {
  interface Window {
    __JTO_FORMAT__?: FormatName;
  }
}

export const FORMAT: FormatName =
  (typeof window !== 'undefined' && window.__JTO_FORMAT__) || 'docx';

export const FORMAT_LABEL = FORMAT === 'docx' ? 'Document' : 'Presentation';
export const FORMAT_EXT = FORMAT === 'docx' ? '.docx' : '.pptx';

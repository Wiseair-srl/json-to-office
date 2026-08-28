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

/**
 * The declared type is a promise the runtime cannot keep: `__JTO_FORMAT__`
 * arrives from an injected script tag, so anything at all can be sitting there.
 * An unrecognized value used to flow straight into `QUALITY_RULES[FORMAT]` and
 * friends, where the lookup returns undefined and the next `.map` throws — a
 * blank playground rather than a wrong label. Narrow it once, here, so every
 * consumer downstream really does hold a `FormatName`.
 */
const FORMATS: readonly FormatName[] = ['docx', 'pptx'];

function injectedFormat(): FormatName {
  if (typeof window === 'undefined') return 'docx';
  const injected = window.__JTO_FORMAT__;
  return FORMATS.includes(injected as FormatName)
    ? (injected as FormatName)
    : 'docx';
}

export const FORMAT: FormatName = injectedFormat();

export const FORMAT_LABEL = FORMAT === 'docx' ? 'Document' : 'Presentation';
export const FORMAT_EXT = FORMAT === 'docx' ? '.docx' : '.pptx';

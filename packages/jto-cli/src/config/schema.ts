import { Type, Static } from '@sinclair/typebox';

/**
 * Dev-server config file. Every key here is read by the dev server — inert
 * keys (playground flags, api.*, paths.*, server.cors, development.hmr /
 * sourceMap / verbose) were removed rather than left to imply an effect they
 * never had. Unknown keys still validate, so older config files keep loading.
 */
export const ConfigSchema = Type.Object({
  mode: Type.Union([Type.Literal('development'), Type.Literal('production')], {
    default: 'development',
  }),

  server: Type.Object({
    port: Type.Number({ default: 3003, minimum: 0, maximum: 65535 }),
    host: Type.String({ default: 'localhost' }),
  }),

  development: Type.Object({
    hmrPort: Type.Optional(Type.Number()),
  }),
});

export type Config = Static<typeof ConfigSchema>;

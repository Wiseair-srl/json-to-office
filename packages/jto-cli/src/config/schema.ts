import { Type, Static } from '@sinclair/typebox';

export const ConfigSchema = Type.Object({
  mode: Type.Union([Type.Literal('development'), Type.Literal('production')], {
    default: 'development',
  }),

  server: Type.Object({
    port: Type.Number({ default: 3003, minimum: 0, maximum: 65535 }),
    host: Type.String({ default: 'localhost' }),
    cors: Type.Optional(
      Type.Object({
        origin: Type.Union([Type.String(), Type.Array(Type.String())]),
        credentials: Type.Boolean({ default: true }),
      })
    ),
  }),

  api: Type.Object({
    basePath: Type.String({ default: '/api' }),
    rateLimit: Type.Optional(
      Type.Object({
        windowMs: Type.Number({ default: 60000 }),
        max: Type.Number({ default: 100 }),
      })
    ),
    upload: Type.Object({
      maxFileSize: Type.Number({ default: 10 * 1024 * 1024 }),
      allowedMimeTypes: Type.Array(Type.String(), {
        default: ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'],
      }),
    }),
  }),

  playground: Type.Object({
    enabled: Type.Boolean({ default: true }),
    root: Type.String({ default: '../../apps/web-react' }),
    features: Type.Object({
      livePreview: Type.Boolean({ default: true }),
      templateLibrary: Type.Boolean({ default: true }),
      componentBuilder: Type.Boolean({ default: false }),
      collaboration: Type.Boolean({ default: false }),
    }),
  }),

  development: Type.Object({
    hmr: Type.Boolean({ default: true }),
    hmrPort: Type.Optional(Type.Number()),
    sourceMap: Type.Boolean({ default: true }),
    verbose: Type.Boolean({ default: false }),
  }),

  paths: Type.Object({
    templates: Type.String({ default: './templates' }),
    modules: Type.String({ default: './modules' }),
    cache: Type.String({ default: './.cache' }),
  }),
});

export type Config = Static<typeof ConfigSchema>;

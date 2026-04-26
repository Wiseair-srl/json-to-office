import type { Config } from './schema.js';

export const defaultConfig: Config = {
  mode: 'development',

  server: {
    port: 3003,
    host: 'localhost',
    cors: {
      origin: '*',
      credentials: true,
    },
  },

  api: {
    basePath: '/api',
    upload: {
      maxFileSize: 10 * 1024 * 1024,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/svg+xml',
      ],
    },
  },

  playground: {
    enabled: true,
    root: '../../apps/web-react',
    features: {
      livePreview: true,
      templateLibrary: true,
      componentBuilder: false,
      collaboration: false,
    },
  },

  development: {
    hmr: true,
    sourceMap: true,
    verbose: false,
  },

  paths: {
    templates: './templates',
    modules: './modules',
    cache: './.cache',
  },
};

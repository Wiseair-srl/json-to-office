import type { Config } from './schema.js';

export const defaultConfig: Config = {
  mode: 'development',

  server: {
    port: 3003,
    host: 'localhost',
  },

  development: {},
};

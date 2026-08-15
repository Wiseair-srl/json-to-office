import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { Config, ConfigSchema } from './schema.js';
import { Value } from '@sinclair/typebox/value';
import { defaultConfig } from './defaults.js';
import { emitDiagnostic } from '../services/diagnostics.js';

const CONFIG_FILES = [
  'json-to-office.config.ts',
  'json-to-office.config.js',
  'json-to-office.config.mjs',
  'json-to-office.config.json',
  // Legacy support
  'json-to-docx.config.ts',
  'json-to-docx.config.js',
  'json-to-docx.config.json',
  'json-to-pptx.config.ts',
  'json-to-pptx.config.js',
  'json-to-pptx.config.json',
];

function parsePort(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : undefined;
}

export interface LoadConfigOptions {
  /**
   * Port used when neither the config file nor `PORT` names one — lets a
   * caller supply its own default (e.g. the format's port) without the loader
   * having to guess which of the returned values was actually requested.
   */
  defaultPort?: number;
}

/**
 * Callers mutate what they get back (`dev -p` writes straight to
 * `config.server.port`), so never hand out `defaultConfig` or any of its
 * sub-objects — one command's port would leak into every later load.
 */
function cloneDefaults(): Config {
  return structuredClone(defaultConfig);
}

export async function loadConfig(
  configPath?: string,
  options: LoadConfigOptions = {}
): Promise<Config> {
  let userConfig: Partial<Config> = {};

  const configFile = configPath || (await findConfigFile());

  if (configFile) {
    try {
      userConfig = await loadConfigFile(configFile);
    } catch (error: any) {
      emitDiagnostic(`Failed to load config file: ${error.message}`, 'warning');
    }
  }

  const config = deepMerge(cloneDefaults(), userConfig);

  if (process.env.NODE_ENV === 'production') {
    config.mode = 'production';
  }

  // Port precedence: config file > `PORT` (the deployment convention) >
  // caller's default > packaged default. `dev -p` outranks all of them and is
  // applied by the caller.
  const fallbackPort = () =>
    parsePort(process.env.PORT) ??
    options.defaultPort ??
    defaultConfig.server.port;

  if (userConfig.server?.port === undefined) {
    config.server.port = fallbackPort();
  }

  if (!Value.Check(ConfigSchema, config)) {
    const errors = [...Value.Errors(ConfigSchema, config)];
    emitDiagnostic(
      `Invalid configuration detected (${errors.length} schema error(s)); using defaults`,
      'warning'
    );
    const fallback = cloneDefaults();
    fallback.server.port = fallbackPort();
    return fallback;
  }

  return config as Config;
}

async function findConfigFile(): Promise<string | null> {
  const cwd = process.cwd();

  for (const filename of CONFIG_FILES) {
    const filepath = resolve(cwd, filename);
    if (existsSync(filepath)) {
      return filepath;
    }
  }

  return null;
}

async function loadConfigFile(filepath: string): Promise<any> {
  const ext = filepath.split('.').pop();

  if (ext === 'json') {
    const content = await readFile(filepath, 'utf-8');
    return JSON.parse(content);
  }

  const fileUrl = pathToFileURL(filepath).href;
  const module = await import(fileUrl);
  return module.default || module;
}

function deepMerge(target: any, source: any): any {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}

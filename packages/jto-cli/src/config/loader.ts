import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { Config, ConfigSchema } from './schema.js';
import { Value } from '@sinclair/typebox/value';
import { defaultConfig } from './defaults.js';

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

export async function loadConfig(configPath?: string): Promise<Config> {
  let userConfig = {};

  const configFile = configPath || (await findConfigFile());

  if (configFile) {
    try {
      userConfig = await loadConfigFile(configFile);
    } catch (error: any) {
      console.warn(`Warning: Failed to load config file: ${error.message}`);
    }
  }

  const config = deepMerge(defaultConfig, userConfig);

  if (process.env.NODE_ENV === 'production') {
    config.mode = 'production';
  }

  if (!Value.Check(ConfigSchema, config)) {
    const errors = [...Value.Errors(ConfigSchema, config)];
    console.warn('Warning: Invalid configuration detected:', errors);
    return defaultConfig;
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

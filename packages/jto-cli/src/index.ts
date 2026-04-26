// Format adapters
export {
  type FormatName,
  type FormatAdapter,
  type GeneratorOptions,
  type GeneratorResult,
  DocxFormatAdapter,
  PptxFormatAdapter,
  createAdapter,
} from './format-adapter.js';

// Generator factory
export { GeneratorFactory } from './services/generator-factory.js';

// Plugin system
export { PluginRegistry } from './services/plugin-registry.js';
export { PluginResolver } from './services/plugin-resolver.js';
export {
  PluginLoader,
  type CustomComponent,
} from './services/plugin-loader.js';
export {
  PluginDiscoveryService,
  type DiscoverOptions,
  type DocumentMetadata,
  type ThemeMetadata,
} from './services/plugin-discovery.js';
export {
  PluginMetadataExtractor,
  type PluginMetadata,
  type PluginExample,
} from './services/plugin-metadata.js';

// Schema generation
export {
  SchemaGenerator,
  type SchemaGenerateOptions,
  type SchemaGenerateResults,
} from './services/schema-generator.js';

// Validation
export {
  JsonValidator,
  type ValidateFileResult,
  type ValidateOptions,
  type ValidationError,
} from './services/json-validator.js';

// Cache events (used by server integrations)
export { cacheEvents, invalidateAllCaches } from './services/cache-events.js';

// Config
export {
  PluginConfigService,
  type PluginConfig,
} from './config/plugin-config.js';
export { loadConfig } from './config/loader.js';
export type { Config } from './config/schema.js';

// CLI entry wiring (for composing a larger CLI, e.g. jto with playground dev)
export { registerCoreCommands } from './cli-register.js';

// Command UI utilities (used by dev command in full jto)
export {
  EXIT_CODES,
  shortPath,
  dimPath,
  createTable,
  formatTiming,
  formatError,
} from './commands/ui.js';

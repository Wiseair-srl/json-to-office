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
export { PluginLoader, type CustomComponent } from './services/plugin-loader.js';
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

// Config
export { PluginConfigService, type PluginConfig } from './config/plugin-config.js';
export { loadConfig } from './config/loader.js';
export type { Config } from './config/schema.js';

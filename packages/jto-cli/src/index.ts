// Host operations live in `@json-to-office/jto-ops` so hosts without a
// terminal (the MCP server) can use them without pulling in ink/react/
// commander/chalk. Re-exported here at the same names: `@json-to-office/jto`
// and other consumers import them from this package.
export {
  type FormatName,
  type FormatAdapter,
  type GeneratorOptions,
  type GeneratorResult,
  DocxFormatAdapter,
  PptxFormatAdapter,
  createAdapter,
  createLibreOfficePptxRasterizer,
  createLibreOfficePptxBatchRasterizer,
  getRasterizerCacheStats,
  clearRasterizerCache,
  type RasterizerCacheStats,
  getFontStager,
  NoopFontStager,
  FontconfigStager,
  WindowsFontStager,
  MacOSCoreTextStager,
  type FontStager,
  type FontStageHandle,
  type FontStageOptions,
} from '@json-to-office/jto-ops';

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
export { loadConfig, parsePort } from './config/loader.js';
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
  renderLines,
  runTask,
  promptText,
  type UiLine,
  type UiTone,
  type TaskReporter,
} from './commands/ui.js';

import { Hono } from 'hono';
import { PluginDiscoveryService } from '../../services/plugin-discovery.js';
import { PluginRegistry } from '../../services/plugin-registry.js';
import { logger } from '../utils/logger.js';
import { AppEnv } from '../types/hono.js';
import { Container } from '../container/index.js';

export const discoveryRouter = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Schema generation helpers (mirrors client-side json-schema-generator.ts)
// ---------------------------------------------------------------------------

function cleanupTypeBoxIds(schema: any): void {
  if (typeof schema !== 'object' || schema === null) return;
  if (schema.$id && /^T\d+$/.test(schema.$id)) delete schema.$id;
  if (schema.$ref && /^T\d+$/.test(schema.$ref)) schema.$ref = '#/definitions/ComponentDefinition';
  if (Array.isArray(schema)) { schema.forEach(cleanupTypeBoxIds); return; }
  Object.keys(schema).forEach((key) => {
    if (typeof schema[key] === 'object' && schema[key] !== null) cleanupTypeBoxIds(schema[key]);
  });
}

async function generateDocumentSchema(format: string): Promise<any> {
  if (format === 'docx') {
    const shared = await import('@json-to-office/shared-docx');
    const unified = shared.generateUnifiedDocumentSchema({ customComponents: [] });
    return shared.convertToJsonSchema(unified, {
      $schema: 'https://json-schema.org/draft-07/schema#',
      $id: 'https://json-to-office.dev/schema/document/v1.0.0',
      title: 'JSON to DOCX Document Definition',
      description: 'Schema for JSON to DOCX JSON document definitions',
    });
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    const unified = shared.generateUnifiedDocumentSchema({ customComponents: [] });
    return shared.convertToJsonSchema(unified, {
      $schema: 'https://json-schema.org/draft-07/schema#',
      $id: 'https://json-to-office.dev/schema/presentation/v1.0.0',
      title: 'JSON to PPTX Presentation Definition',
      description: 'Schema for JSON to PPTX JSON presentation definitions',
    });
  }
}

async function generateThemeSchema(format: string): Promise<any> {
  let source: any;
  let label: string;
  if (format === 'docx') {
    const shared = await import('@json-to-office/shared-docx');
    source = shared.ThemeConfigSchema;
    label = 'DOCX';
  } else {
    const shared = await import('@json-to-office/shared-pptx');
    source = shared.ThemeConfigSchema;
    label = 'PPTX';
  }
  const schema = JSON.parse(JSON.stringify(source));
  cleanupTypeBoxIds(schema);
  return {
    ...schema,
    $schema: 'https://json-schema.org/draft-07/schema#',
    $id: 'https://json-to-office.dev/schemas/theme/v1.0.0',
    title: `JSON to ${label} Theme`,
    description: `Theme definition for JSON to ${label} ${format === 'docx' ? 'documents' : 'presentations'}`,
  };
}

discoveryRouter.get('/all', async (c) => {
  try {
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const [plugins, documents, themes] = await Promise.all([
      discovery.discoverPlugins(),
      discovery.discoverDocuments(format),
      discovery.discoverThemes(),
    ]);
    const results = { plugins, documents, themes };
    return c.json({
      success: true,
      data: results,
      counts: {
        plugins: results.plugins.length,
        documents: results.documents.length,
        themes: results.themes.length,
      },
    });
  } catch (error: any) {
    logger.error('Discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/plugins', async (c) => {
  try {
    const includeSchemas = c.req.query('schemas') === 'true';
    const includeExamples = c.req.query('examples') === 'true';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const plugins = await discovery.discoverPlugins();
    const processed = plugins.map((plugin) => {
      const result: any = { ...plugin };
      if (!includeSchemas && result.schema) {
        delete result.schema.raw;
        delete result.schema.jsonSchema;
      }
      if (!includeExamples) delete result.examples;
      return result;
    });
    return c.json({ success: true, data: processed, count: plugins.length });
  } catch (error: any) {
    logger.error('Plugin discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/documents', async (c) => {
  try {
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const documents = await discovery.discoverDocuments(format);
    return c.json({ success: true, data: documents, count: documents.length });
  } catch (error: any) {
    logger.error('Document discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/themes', async (c) => {
  try {
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const themes = await discovery.discoverThemes();
    return c.json({ success: true, data: themes, count: themes.length });
  } catch (error: any) {
    logger.error('Theme discovery failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/plugin/:name', async (c) => {
  try {
    const pluginName = c.req.param('name');
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const plugins = await discovery.discoverPlugins();
    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin) return c.json({ success: false, error: `Plugin '${pluginName}' not found` }, 404);
    return c.json({ success: true, data: plugin });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.post('/load-plugins', async (c) => {
  // Require API key for plugin loading regardless of global auth setting
  const apiKey = c.req.header('X-API-Key') || c.req.header('Authorization');
  if (!apiKey && process.env.NODE_ENV === 'production') {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  try {
    const registry = PluginRegistry.getInstance();
    const result = await registry.discoverAndLoad();
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/documents/:name/content', async (c) => {
  try {
    const name = c.req.param('name');
    const format = Container.getAdapter().name as 'docx' | 'pptx';
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const content = await discovery.getDocumentContent(name, format);
    return c.text(content);
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    return c.json({ success: false, error: error.message }, status);
  }
});

discoveryRouter.get('/themes/:name/content', async (c) => {
  try {
    const name = c.req.param('name');
    const discovery = new PluginDiscoveryService({
      maxDepth: 10,
      includeNodeModules: false,
      verbose: false,
    });
    const content = await discovery.getThemeContent(name);
    return c.text(content);
  } catch (error: any) {
    const status = error.message.includes('not found') ? 404 : 500;
    return c.json({ success: false, error: error.message }, status);
  }
});

discoveryRouter.get('/schemas/document', async (c) => {
  try {
    const adapter = Container.getAdapter();
    const schema = await generateDocumentSchema(adapter.name);
    return c.json({ success: true, data: schema });
  } catch (error: any) {
    logger.error('Document schema generation failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

discoveryRouter.get('/schemas/theme', async (c) => {
  try {
    const adapter = Container.getAdapter();
    const schema = await generateThemeSchema(adapter.name);
    return c.json({ success: true, data: schema });
  } catch (error: any) {
    logger.error('Theme schema generation failed', { error: error.message });
    return c.json({ success: false, error: error.message }, 500);
  }
});

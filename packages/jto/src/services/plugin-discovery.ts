import * as path from 'path';
import * as fs from 'fs/promises';
import { FileSystemScanner, type DiscoveryType } from './file-scanner.js';
import { PluginLoader } from './plugin-loader.js';
import {
  PluginMetadataExtractor,
  type PluginMetadata,
} from './plugin-metadata.js';
import { getProjectRoot, resolveScopePath } from '../utils/project-root.js';

export interface DiscoverOptions {
  scope?: string;
  maxDepth?: number;
  includeNodeModules?: boolean;
  verbose?: boolean;
  type?: DiscoveryType | 'all';
}

export interface DocumentMetadata {
  name: string;
  path: string;
  location: 'current' | 'downstream';
  type?: string;
  title?: string;
  description?: string;
  theme?: string;
}

export interface ThemeMetadata {
  name: string;
  path: string;
  location: 'current' | 'downstream';
  description?: string;
}

export type DiscoveryResult = PluginMetadata | DocumentMetadata | ThemeMetadata;

export class PluginDiscoveryService {
  private scanner: FileSystemScanner;
  private loader: PluginLoader;
  private metadataExtractor: PluginMetadataExtractor;
  private options: DiscoverOptions;
  private searchPath: string;
  private projectRoot: string;

  constructor(options: DiscoverOptions = {}) {
    this.options = options;
    this.scanner = new FileSystemScanner();
    this.loader = new PluginLoader();

    this.projectRoot = getProjectRoot();

    if (options.scope) {
      try {
        this.searchPath = resolveScopePath(options.scope, this.projectRoot);
      } catch (error: any) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
    } else {
      this.searchPath = this.projectRoot;
    }

    this.metadataExtractor = new PluginMetadataExtractor(this.searchPath);
  }

  async discover(format?: 'docx' | 'pptx'): Promise<PluginMetadata[]> {
    return this.discoverPlugins(format);
  }

  async discoverPlugins(format?: 'docx' | 'pptx'): Promise<PluginMetadata[]> {
    const startPath = this.searchPath;

    try {
      await this.loader.initialize();

      const allPluginPaths = await this.searchDownstream(startPath, 'plugin');
      const uniquePaths = this.scanner.deduplicatePaths(allPluginPaths);

      if (this.options.verbose) {
        console.log(`Found ${uniquePaths.length} potential plugin files`);
      }

      const loadedModules = await this.loader.loadPlugins(uniquePaths);

      if (this.options.verbose) {
        console.log(`Successfully loaded ${loadedModules.size} plugins`);
      }

      const metadata = await this.metadataExtractor.extractBatch(loadedModules);

      metadata.sort((a, b) => {
        const locationOrder: Record<string, number> = {
          current: 0,
          downstream: 1,
          upstream: 2,
        };
        const locationDiff =
          locationOrder[a.location] - locationOrder[b.location];
        if (locationDiff !== 0) return locationDiff;
        return a.name.localeCompare(b.name);
      });

      if (format) {
        return metadata.filter((p) => !p.format || p.format === format);
      }
      return metadata;
    } finally {
      this.loader.cleanup();
    }
  }

  async discoverDocuments(
    format?: 'docx' | 'pptx'
  ): Promise<DocumentMetadata[]> {
    const startPath = this.searchPath;

    const discoveryType: DiscoveryType =
      format === 'pptx' ? 'pptx-document' : 'docx-document';
    const ext = format === 'pptx' ? '.pptx.json' : '.docx.json';

    const allDocumentPaths = await this.searchDownstream(
      startPath,
      discoveryType
    );
    const uniquePaths = this.scanner.deduplicatePaths(allDocumentPaths);

    const metadata: DocumentMetadata[] = [];
    for (const docPath of uniquePaths) {
      try {
        const content = await fs.readFile(docPath, 'utf-8');
        const json = JSON.parse(content);
        const location = this.getFileLocation(docPath, startPath);

        metadata.push({
          name: path.basename(docPath, ext),
          path: docPath,
          location,
          type: json.name || 'document',
          title: json.props?.title || json.title,
          description: json.props?.metadata?.description || json.description,
          theme: json.props?.theme || json.theme,
        });
      } catch {}
    }

    metadata.sort((a, b) => {
      const locationOrder: Record<string, number> = {
        current: 0,
        downstream: 1,
        upstream: 2,
      };
      const locationDiff =
        locationOrder[a.location] - locationOrder[b.location];
      if (locationDiff !== 0) return locationDiff;
      return a.name.localeCompare(b.name);
    });

    return metadata;
  }

  async discoverThemes(format: 'docx' | 'pptx'): Promise<ThemeMetadata[]> {
    const startPath = this.searchPath;

    const discoveryType: DiscoveryType =
      format === 'pptx' ? 'pptx-theme' : 'docx-theme';
    const ext = format === 'pptx' ? '.pptx.theme.json' : '.docx.theme.json';

    const allThemePaths = await this.searchDownstream(startPath, discoveryType);
    const uniquePaths = this.scanner.deduplicatePaths(allThemePaths);

    const metadata: ThemeMetadata[] = [];
    for (const themePath of uniquePaths) {
      try {
        const content = await fs.readFile(themePath, 'utf-8');
        const json = JSON.parse(content);
        const location = this.getFileLocation(themePath, startPath);

        metadata.push({
          name: path.basename(themePath, ext),
          path: themePath,
          location,
          description: json.description || json.metadata?.description,
        });
      } catch {}
    }

    metadata.sort((a, b) => {
      const locationOrder: Record<string, number> = {
        current: 0,
        downstream: 1,
        upstream: 2,
      };
      const locationDiff =
        locationOrder[a.location] - locationOrder[b.location];
      if (locationDiff !== 0) return locationDiff;
      return a.name.localeCompare(b.name);
    });

    return metadata;
  }

  async getDocumentContent(
    name: string,
    format?: 'docx' | 'pptx'
  ): Promise<string> {
    const documents = await this.discoverDocuments(format);
    const document = documents.find((doc) => doc.name === name);
    if (!document) throw new Error(`Document '${name}' not found`);
    return await fs.readFile(document.path, 'utf-8');
  }

  async getThemeContent(
    name: string,
    format: 'docx' | 'pptx'
  ): Promise<string> {
    const themes = await this.discoverThemes(format);
    const theme = themes.find((t) => t.name === name);
    if (!theme) throw new Error(`Theme '${name}' not found`);
    return await fs.readFile(theme.path, 'utf-8');
  }

  async discoverAll(format: 'docx' | 'pptx'): Promise<{
    plugins: PluginMetadata[];
    documents: DocumentMetadata[];
    themes: ThemeMetadata[];
  }> {
    const [plugins, documents, themes] = await Promise.all([
      this.discoverPlugins(format),
      this.discoverDocuments(format),
      this.discoverThemes(format),
    ]);
    return { plugins, documents, themes };
  }

  private getFileLocation(
    filePath: string,
    startPath: string
  ): 'current' | 'downstream' {
    const relative = path.relative(startPath, filePath);
    if (relative === path.basename(filePath)) {
      return 'current';
    }
    return 'downstream';
  }

  private async searchDownstream(
    startPath: string,
    fileType: DiscoveryType = 'plugin'
  ): Promise<string[]> {
    const resolvedPath = path.resolve(startPath);

    const plugins = await this.scanner.scan(resolvedPath, fileType, {
      maxDepth: this.options.maxDepth || 10,
      excludeNodeModules: !this.options.includeNodeModules,
    });

    if (await this.scanner.hasPackageJson(resolvedPath)) {
      const monorepoPlugins = await this.scanner.scanMonorepoLocations(
        resolvedPath,
        fileType
      );

      const downstreamMonorepoPlugins = monorepoPlugins.filter((p) => {
        const relative = path.relative(resolvedPath, p);
        return !relative.startsWith('..');
      });

      plugins.push(...downstreamMonorepoPlugins);
    }

    return plugins;
  }

  async hasPlugins(): Promise<boolean> {
    const plugins = await this.discoverPlugins();
    return plugins.length > 0;
  }

  async getPluginByName(name: string): Promise<PluginMetadata | undefined> {
    const plugins = await this.discoverPlugins();
    return plugins.find((p) => p.name === name);
  }
}

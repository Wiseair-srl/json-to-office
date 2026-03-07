import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface ScanOptions {
  maxDepth?: number;
  excludeNodeModules?: boolean;
  additionalIgnore?: string[];
}

export type DiscoveryType = 'plugin' | 'document' | 'theme';

export interface FilePattern {
  type: DiscoveryType;
  pattern: string;
  monorepoPatterns?: string[];
}

export class FileSystemScanner {
  private readonly FILE_PATTERNS: Record<DiscoveryType, FilePattern> = {
    plugin: {
      type: 'plugin',
      pattern: '*.component.ts',
      monorepoPatterns: [
        'packages/*/src/**/*.component.ts',
        'packages/**/src/**/*.component.ts',
        'apps/*/src/**/*.component.ts',
        'apps/**/src/**/*.component.ts',
        'libs/*/src/**/*.component.ts',
        'libs/**/src/**/*.component.ts',
        'components/**/*.component.ts',
        'plugins/**/*.component.ts',
        'src/plugins/**/*.component.ts',
        'src/components/**/*.component.ts',
      ],
    },
    document: {
      type: 'document',
      pattern: '*.document.json',
      monorepoPatterns: [
        'packages/*/src/**/*.document.json',
        'packages/**/src/**/*.document.json',
        'apps/*/src/**/*.document.json',
        'apps/**/src/**/*.document.json',
        'libs/*/src/**/*.document.json',
        'libs/**/src/**/*.document.json',
        'documents/**/*.document.json',
        'src/documents/**/*.document.json',
        'templates/**/*.document.json',
        'src/templates/**/*.document.json',
      ],
    },
    theme: {
      type: 'theme',
      pattern: '*.theme.json',
      monorepoPatterns: [
        'packages/*/src/**/*.theme.json',
        'packages/**/src/**/*.theme.json',
        'apps/*/src/**/*.theme.json',
        'apps/**/src/**/*.theme.json',
        'libs/*/src/**/*.theme.json',
        'libs/**/src/**/*.theme.json',
        'themes/**/*.theme.json',
        'src/themes/**/*.theme.json',
        'templates/**/*.theme.json',
        'src/templates/**/*.theme.json',
      ],
    },
  };

  private readonly EXCLUDE_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/tmp/**',
    '**/.cache/**',
    '**/out/**',
  ];

  async scan(
    basePath: string,
    fileType: DiscoveryType = 'plugin',
    options: ScanOptions = {}
  ): Promise<string[]> {
    const {
      maxDepth = 10,
      excludeNodeModules = true,
      additionalIgnore = [],
    } = options;

    const patterns = this.buildPatterns(fileType, maxDepth);
    const ignore = this.buildIgnorePatterns(
      excludeNodeModules,
      additionalIgnore
    );

    try {
      const files = await glob(patterns, {
        cwd: basePath,
        absolute: true,
        ignore,
        nodir: true,
      });

      return files;
    } catch {
      return [];
    }
  }

  async scanMonorepoLocations(
    rootPath: string,
    fileType: DiscoveryType = 'plugin'
  ): Promise<string[]> {
    const monorepoPatterns =
      this.FILE_PATTERNS[fileType].monorepoPatterns || [];

    const allFiles: string[] = [];

    for (const pattern of monorepoPatterns) {
      try {
        const matches = await glob(pattern, {
          cwd: rootPath,
          absolute: true,
          ignore: this.EXCLUDE_PATTERNS,
        });
        allFiles.push(...matches);
      } catch {}
    }

    return allFiles;
  }

  async hasPackageJson(dirPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(dirPath, 'package.json'));
      return true;
    } catch {
      return false;
    }
  }

  isInNodeModules(currentPath: string): boolean {
    return currentPath.includes('node_modules');
  }

  private buildPatterns(fileType: DiscoveryType, maxDepth: number): string[] {
    const filePattern = this.FILE_PATTERNS[fileType].pattern;
    const patterns: string[] = [filePattern];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const depthPattern = Array(depth).fill('*').join('/') + '/' + filePattern;
      patterns.push(depthPattern);
    }

    return patterns;
  }

  private buildIgnorePatterns(
    excludeNodeModules: boolean,
    additionalIgnore: string[]
  ): string[] {
    let ignore = [...this.EXCLUDE_PATTERNS];

    if (!excludeNodeModules) {
      ignore = ignore.filter((pattern) => !pattern.includes('node_modules'));
    }

    return [...ignore, ...additionalIgnore];
  }

  deduplicatePaths(paths: string[]): string[] {
    const uniquePaths = new Set(paths.map((p) => path.resolve(p)));
    return Array.from(uniquePaths);
  }

  async scanAll(
    basePath: string,
    options: ScanOptions = {}
  ): Promise<{ plugins: string[]; documents: string[]; themes: string[] }> {
    const [plugins, documents, themes] = await Promise.all([
      this.scan(basePath, 'plugin', options),
      this.scan(basePath, 'document', options),
      this.scan(basePath, 'theme', options),
    ]);

    return { plugins, documents, themes };
  }
}

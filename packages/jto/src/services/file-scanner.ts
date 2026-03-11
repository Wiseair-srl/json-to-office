import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface ScanOptions {
  maxDepth?: number;
  excludeNodeModules?: boolean;
  additionalIgnore?: string[];
}

export type DiscoveryType = 'plugin' | 'docx-document' | 'pptx-document' | 'theme';

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
    'docx-document': {
      type: 'docx-document',
      pattern: '*.docx.json',
      monorepoPatterns: [
        'packages/*/src/**/*.docx.json',
        'packages/**/src/**/*.docx.json',
        'apps/*/src/**/*.docx.json',
        'apps/**/src/**/*.docx.json',
        'libs/*/src/**/*.docx.json',
        'libs/**/src/**/*.docx.json',
        'documents/**/*.docx.json',
        'src/documents/**/*.docx.json',
        'templates/**/*.docx.json',
        'src/templates/**/*.docx.json',
      ],
    },
    'pptx-document': {
      type: 'pptx-document',
      pattern: '*.pptx.json',
      monorepoPatterns: [
        'packages/*/src/**/*.pptx.json',
        'packages/**/src/**/*.pptx.json',
        'apps/*/src/**/*.pptx.json',
        'apps/**/src/**/*.pptx.json',
        'libs/*/src/**/*.pptx.json',
        'libs/**/src/**/*.pptx.json',
        'documents/**/*.pptx.json',
        'src/documents/**/*.pptx.json',
        'templates/**/*.pptx.json',
        'src/templates/**/*.pptx.json',
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

}

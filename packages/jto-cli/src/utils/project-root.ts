import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT_MARKERS = [
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
  'turbo.json',
  'lerna.json',
  'nx.json',
  '.git',
  'package.json',
];

function hasWorkspaces(packageJsonPath: string): boolean {
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return !!(pkg.workspaces || pkg.private === true);
  } catch {
    return false;
  }
}

export function findProjectRoot(startPath?: string): string | null {
  let currentPath = path.resolve(startPath || process.cwd());
  const root = path.parse(currentPath).root;

  while (currentPath !== root) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      const markerPath = path.join(currentPath, marker);

      if (fs.existsSync(markerPath)) {
        if (marker === 'package.json') {
          if (hasWorkspaces(markerPath)) {
            return currentPath;
          }
          continue;
        }
        return currentPath;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  const fallbackPackageJson = path.join(
    startPath || process.cwd(),
    'package.json'
  );
  if (fs.existsSync(fallbackPackageJson)) {
    return startPath || process.cwd();
  }

  return null;
}

export function getProjectRoot(startPath?: string): string {
  const root = findProjectRoot(startPath);
  if (!root) {
    console.warn(
      'Warning: Could not detect project root, using current directory'
    );
    return process.cwd();
  }
  return root;
}

export function isWithinProject(
  targetPath: string,
  projectRoot: string
): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(projectRoot);
  return resolvedTarget.startsWith(resolvedRoot);
}

export function resolveScopePath(scope: string, projectRoot: string): string {
  const resolved = path.resolve(projectRoot, scope);

  if (!isWithinProject(resolved, projectRoot)) {
    throw new Error(`Scope path "${scope}" is outside the project root`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Scope directory not found: ${scope}`);
  }

  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Scope must be a directory, not a file: ${scope}`);
  }

  return resolved;
}

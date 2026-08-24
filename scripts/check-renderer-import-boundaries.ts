import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'scripts/fixtures/renderer-import-boundaries');
const eslint = path.join(root, 'node_modules/eslint/bin/eslint.js');

const cases = [
  {
    fixture: 'forbidden-static.ts',
    filePath: 'packages/core-pptx/src/ir/forbidden-static.ts',
    ruleId: 'no-restricted-imports',
  },
  {
    fixture: 'forbidden-dynamic.ts',
    filePath: 'packages/core-pptx/src/ir/forbidden-dynamic.ts',
    ruleId: 'no-restricted-syntax',
  },
  {
    fixture: 'forbidden-export.ts',
    filePath: 'packages/core-pptx/src/ir/forbidden-export.ts',
    ruleId: 'no-restricted-imports',
  },
] as const;

for (const testCase of cases) {
  const source = await readFile(path.join(fixtures, testCase.fixture), 'utf8');
  const result = spawnSync(
    process.execPath,
    [eslint, '--stdin', '--stdin-filename', testCase.filePath],
    {
      cwd: root,
      input: source,
      encoding: 'utf8',
    }
  );
  if (
    result.status !== 1 ||
    !`${result.stdout}${result.stderr}`.includes(testCase.ruleId)
  ) {
    throw new Error(
      `${testCase.fixture} did not fail ${testCase.ruleId} at ${testCase.filePath}\n${result.stdout}${result.stderr}`
    );
  }
}

process.stdout.write('Renderer import-boundary fixtures passed.\n');

/**
 * Proves the renderer import seams are actually enforced — in two layers,
 * because each catches a failure the other cannot see.
 *
 * `RULE_CASES` feed forbidden source through ESLint under a guarded filename
 * and assert the expected rule fires. That covers the `.eslintrc.cjs` overrides
 * themselves: the static patterns, the dynamic-`import()` selectors, and the
 * `export ... from` forms `no-restricted-imports` also governs.
 *
 * `DISCOVERY_CASES` plant a violation in a real guarded directory and run the
 * package's own `lint` script over it. That covers the half a rule test cannot:
 * whether the script's file selection ever reaches the directory. A correct
 * rule that no glob visits enforces nothing, and the shell expands `**` to a
 * single level — so `eslint src/**\/*.ts` silently skipped every renderer
 * backend until this check existed.
 */
import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'scripts/fixtures/renderer-import-boundaries');
const eslint = path.join(root, 'node_modules/eslint/bin/eslint.js');

const RULE_CASES = [
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
  {
    fixture: 'forbidden-renderer-root-export.ts',
    filePath: 'packages/core-pptx/src/ir/forbidden-renderer-root-export.ts',
    ruleId: 'no-restricted-imports',
  },
  {
    fixture: 'forbidden-docx-static.ts',
    filePath: 'packages/core-docx/src/ir/forbidden-docx-static.ts',
    ruleId: 'no-restricted-imports',
  },
  {
    fixture: 'forbidden-docx-dynamic.ts',
    filePath:
      'packages/core-docx/src/renderers/docxjs/forbidden-docx-dynamic.ts',
    ruleId: 'no-restricted-syntax',
  },
] as const;

/**
 * One planted file per guarded directory that the broken glob used to miss —
 * every renderer backend sits three levels below the package root.
 */
const DISCOVERY_CASES = [
  {
    package: 'packages/core-pptx',
    plants: [
      {
        file: 'src/renderers/office-open/__boundary-probe.ts',
        source: "import PptxGenJS from 'pptxgenjs';\n\nvoid PptxGenJS;\n",
      },
      {
        file: 'src/renderers/pptxgenjs/__boundary-probe.ts',
        source: "export { default } from '@office-open/pptx';\n",
      },
    ],
  },
  {
    package: 'packages/core-docx',
    plants: [
      {
        file: 'src/renderers/office-open/__boundary-probe.ts',
        source: "import { Document } from 'docx';\n\nvoid Document;\n",
      },
      {
        file: 'src/renderers/docxjs/__boundary-probe.ts',
        source: "void import('@office-open/docx');\n",
      },
    ],
  },
] as const;

for (const testCase of RULE_CASES) {
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

for (const testCase of DISCOVERY_CASES) {
  const cwd = path.join(root, testCase.package);
  const manifest = JSON.parse(
    await readFile(path.join(cwd, 'package.json'), 'utf8')
  ) as { scripts?: Record<string, string> };
  const lint = manifest.scripts?.lint;
  if (!lint) {
    throw new Error(`${testCase.package} has no lint script to verify.`);
  }
  const planted = testCase.plants.map((plant) => path.join(cwd, plant.file));
  try {
    await Promise.all(
      testCase.plants.map((plant, index) =>
        writeFile(planted[index], plant.source)
      )
    );
    const result = spawnSync(lint, {
      cwd,
      shell: true,
      encoding: 'utf8',
    });
    const output = `${result.stdout}${result.stderr}`;
    const unseen = testCase.plants.filter(
      (plant) => !output.includes(path.basename(path.dirname(plant.file)))
    );
    if (result.status === 0 || unseen.length > 0) {
      throw new Error(
        `${testCase.package}'s lint script does not reach ${unseen
          .map((plant) => plant.file)
          .join(
            ', '
          )}. Its file selection must cover every guarded directory ` +
          `(a shell-expanded 'src/**/*.ts' only reaches one level down).\n${output}`
      );
    }
  } finally {
    await Promise.all(planted.map((file) => rm(file, { force: true })));
  }
}

process.stdout.write(
  `Renderer import boundaries enforced: ${RULE_CASES.length} rule fixtures, ` +
    `${DISCOVERY_CASES.length} lint-discovery probes.\n`
);

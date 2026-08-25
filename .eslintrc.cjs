/**
 * Renderer seams, enforced.
 *
 * Each backend library belongs to exactly one directory, and production
 * compiler/IR modules may not reach into `renderers/` at all. Static specifiers
 * are restricted with `no-restricted-imports`; dynamic `import()` is invisible
 * to that rule on ESLint 8, so every restriction is mirrored as a
 * `no-restricted-syntax` pair covering both the `ImportExpression` node modern
 * parsers emit and the older `CallExpression` + `Import` callee shape.
 *
 * Specifier regexes are anchored to whole path segments so `docx` does not also
 * catch `docx-templates`, matching what the static patterns already do.
 */
const restrictedPattern = (group, message) => ({ group, message });
const restrictedDynamic = (specifier, message) => [
  { selector: `ImportExpression[source.value=${specifier}]`, message },
  {
    selector: `CallExpression[callee.type='Import'][arguments.0.value=${specifier}]`,
    message,
  },
];
const restrictedRules = (patterns, syntax) => ({
  'no-restricted-imports': ['error', { patterns }],
  'no-restricted-syntax': ['error', ...syntax],
});

const PPTXGENJS_ONLY =
  'Only core-pptx/src/renderers/pptxgenjs may import pptxgenjs.';
const DOCXJS_ONLY = 'Only core-docx/src/renderers/docxjs may import docx.';
const OFFICE_OPEN_ONLY =
  'Only a core renderer/office-open directory may import @office-open packages.';
const NO_RENDERERS = 'Compiler and production IR modules may not import renderers.';

const pptxgenjsImport = restrictedPattern(
  ['pptxgenjs', 'pptxgenjs/*'],
  PPTXGENJS_ONLY
);
const pptxgenjsDynamic = restrictedDynamic(
  String.raw`/^pptxgenjs(\/|$)/`,
  PPTXGENJS_ONLY
);
const docxImport = restrictedPattern(['docx', 'docx/*'], DOCXJS_ONLY);
const docxDynamic = restrictedDynamic(String.raw`/^docx(\/|$)/`, DOCXJS_ONLY);
const officeOpenImport = restrictedPattern(['@office-open/*'], OFFICE_OPEN_ONLY);
const officeOpenDynamic = restrictedDynamic(
  String.raw`/^@office-open(\/|$)/`,
  OFFICE_OPEN_ONLY
);
const rendererImport = restrictedPattern(
  ['**/renderers', '**/renderers/**'],
  NO_RENDERERS
);
const rendererDynamic = restrictedDynamic(
  String.raw`/(^|\/)renderers(\/|$)/`,
  NO_RENDERERS
);

module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    indent: 'off',
    'linebreak-style': ['error', 'unix'],
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['**/packages/core-pptx/src/**/*.{ts,tsx}'],
      excludedFiles: [
        '**/packages/core-pptx/src/renderers/pptxgenjs/**/*.{ts,tsx}',
        '**/packages/core-pptx/src/renderers/office-open/**/*.{ts,tsx}',
      ],
      rules: restrictedRules(
        [pptxgenjsImport, officeOpenImport],
        [...pptxgenjsDynamic, ...officeOpenDynamic]
      ),
    },
    {
      files: ['**/packages/core-docx/src/**/*.{ts,tsx}'],
      excludedFiles: [
        '**/packages/core-docx/src/renderers/docxjs/**/*.{ts,tsx}',
        '**/packages/core-docx/src/renderers/office-open/**/*.{ts,tsx}',
      ],
      rules: restrictedRules(
        [docxImport, officeOpenImport],
        [...docxDynamic, ...officeOpenDynamic]
      ),
    },
    {
      files: ['**/packages/core-pptx/src/renderers/pptxgenjs/**/*.{ts,tsx}'],
      rules: restrictedRules([officeOpenImport], officeOpenDynamic),
    },
    {
      files: ['**/packages/core-pptx/src/renderers/office-open/**/*.{ts,tsx}'],
      rules: restrictedRules([pptxgenjsImport], pptxgenjsDynamic),
    },
    {
      files: ['**/packages/core-docx/src/renderers/docxjs/**/*.{ts,tsx}'],
      rules: restrictedRules([officeOpenImport], officeOpenDynamic),
    },
    {
      files: ['**/packages/core-docx/src/renderers/office-open/**/*.{ts,tsx}'],
      rules: restrictedRules([docxImport], docxDynamic),
    },
    {
      files: ['**/packages/core-pptx/src/ir/**/*.ts'],
      excludedFiles: ['**/__tests__/**'],
      rules: restrictedRules(
        [pptxgenjsImport, officeOpenImport, rendererImport],
        [...pptxgenjsDynamic, ...officeOpenDynamic, ...rendererDynamic]
      ),
    },
    {
      files: ['**/packages/core-docx/src/ir/**/*.ts'],
      excludedFiles: ['**/__tests__/**'],
      rules: restrictedRules(
        [docxImport, officeOpenImport, rendererImport],
        [...docxDynamic, ...officeOpenDynamic, ...rendererDynamic]
      ),
    },
    {
      files: ['**/packages/jto/**/*.ts', '**/packages/jto/**/*.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      files: [
        '**/packages/jto/src/client/**/*.ts',
        '**/packages/jto/src/client/**/*.tsx',
      ],
      env: {
        browser: true,
        es2021: true,
        node: true,
      },
    },
  ],
};

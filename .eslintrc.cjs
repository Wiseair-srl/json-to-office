const restrictedPattern = (group, message) => ({ group, message });
const restrictedSyntax = (selector, message) => ({ selector, message });
const restrictedRules = (patterns, syntax) => ({
  'no-restricted-imports': ['error', { patterns }],
  'no-restricted-syntax': ['error', ...syntax],
});

const pptxgenjsImport = restrictedPattern(
  ['pptxgenjs', 'pptxgenjs/*'],
  'Only core-pptx/src/renderers/pptxgenjs may import pptxgenjs.'
);
const pptxgenjsDynamic = [
  restrictedSyntax(
    'ImportExpression[source.value=/^pptxgenjs/]',
    'Only core-pptx/src/renderers/pptxgenjs may dynamically import pptxgenjs.'
  ),
  restrictedSyntax(
    "CallExpression[callee.type='Import'][arguments.0.value=/^pptxgenjs/]",
    'Only core-pptx/src/renderers/pptxgenjs may dynamically import pptxgenjs.'
  ),
];
const docxImport = restrictedPattern(
  ['docx', 'docx/*'],
  'Only core-docx/src/renderers/docxjs may import docx.'
);
const docxDynamic = [
  restrictedSyntax(
    'ImportExpression[source.value=/^docx/]',
    'Only core-docx/src/renderers/docxjs may dynamically import docx.'
  ),
  restrictedSyntax(
    "CallExpression[callee.type='Import'][arguments.0.value=/^docx/]",
    'Only core-docx/src/renderers/docxjs may dynamically import docx.'
  ),
];
const officeOpenImport = restrictedPattern(
  ['@office-open/*'],
  'Only a core renderer/office-open directory may import @office-open packages.'
);
const officeOpenDynamic = [
  restrictedSyntax(
    'ImportExpression[source.value=/^@office-open/]',
    'Only a core renderer/office-open directory may dynamically import @office-open packages.'
  ),
  restrictedSyntax(
    "CallExpression[callee.type='Import'][arguments.0.value=/^@office-open/]",
    'Only a core renderer/office-open directory may dynamically import @office-open packages.'
  ),
];
const rendererImport = restrictedPattern(
  ['**/renderers', '**/renderers/**'],
  'Compiler and production IR modules may not import renderers.'
);
const rendererDynamic = [
  restrictedSyntax(
    'ImportExpression[source.value=/renderers/]',
    'Compiler and production IR modules may not dynamically import renderers.'
  ),
  restrictedSyntax(
    "CallExpression[callee.type='Import'][arguments.0.value=/renderers/]",
    'Compiler and production IR modules may not dynamically import renderers.'
  ),
];

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

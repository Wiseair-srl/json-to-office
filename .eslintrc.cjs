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

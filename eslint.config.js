// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Node scripts and config files.
    files: ['scripts/**/*.js', '*.config.js'],
    languageOptions: { globals: { __dirname: 'readonly' } },
  },
  {
    // Jest mock factories must use require(), and test harness components hand
    // hook results out to the test through a module-level variable.
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'react-hooks/globals': 'off',
    },
  },
]);

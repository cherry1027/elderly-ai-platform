const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
  { ignores: ['node_modules/**', '.expo/**', '.npm-cache/**', '.verification/**', 'coverage/**'] },
]);

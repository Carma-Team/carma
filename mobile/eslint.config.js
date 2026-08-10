// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Hebrew-range literal caught outside i18n/he.ts means UI copy was written
// inline instead of going through he.ts/en.ts + t(). See docs/i18n.md.
const HEBREW_LITERAL = 'Literal[value=/[\\u0590-\\u05FF]/]';
const HEBREW_TEMPLATE = 'TemplateElement[value.raw=/[\\u0590-\\u05FF]/]';

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/i18n/he.ts',        // the Hebrew resource file itself
      'src/lib/constants.ts',  // labelHe/name fields — the separate bilingual-data-record pattern, see docs/i18n.md
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: HEBREW_LITERAL,
          message: 'Hardcoded Hebrew text — add a key to i18n/he.ts and i18n/en.ts and read it via t() instead.',
        },
        {
          selector: HEBREW_TEMPLATE,
          message: 'Hardcoded Hebrew text in a template literal — add a key to i18n/he.ts and i18n/en.ts and read it via t() instead.',
        },
      ],
    },
  },
]);

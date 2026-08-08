/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // jest-expo's preset does not map the `@/` alias from tsconfig `paths`.
  // Without this every test that imports `@/...` fails to resolve.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Overrides the preset's platform-suffixed patterns (`.ios.test.ts` etc.),
  // which this repo does not use. `[jt]s?(x)` is what makes `.test.tsx` run.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
};

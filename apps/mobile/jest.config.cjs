module.exports = {
  rootDir: __dirname,
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  cacheDirectory: '<rootDir>/.verification/jest-cache',
  clearMocks: true,
};

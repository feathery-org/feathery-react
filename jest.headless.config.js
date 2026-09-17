// Real Chrome covers layout behavior that jsdom cannot represent.
module.exports = {
  displayName: 'headless',
  rootDir: __dirname,
  testEnvironment:
    '<rootDir>/src/assistant/tools/docx/tests/headless/headlessEnvironment.js',
  testMatch: ['<rootDir>/src/**/*.headless.spec.ts'],
  globalSetup:
    '<rootDir>/src/assistant/tools/docx/tests/headless/globalSetup.ts',
  testTimeout: 120000,
  maxWorkers: 2,
  collectCoverage: false
};

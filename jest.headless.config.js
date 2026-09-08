/**
 * The headless real-engine lane. A SEPARATE jest project from the default run:
 * `yarn test` never loads these specs (see `jest.testPathIgnorePatterns` in
 * package.json), so the default suite's shape and runtime are unchanged.
 *
 * Node environment, not jsdom: the document is laid out by a real headless
 * Chrome driven over CDP, which is the whole point - layout registers content
 * controls and walks laid-out widgets, and jsdom does neither.
 */
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

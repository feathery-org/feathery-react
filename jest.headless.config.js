// Real Chrome covers layout behavior that jsdom cannot represent.
module.exports = {
  displayName: 'headless',
  rootDir: __dirname,
  testEnvironment:
    '<rootDir>/src/robin/document/tests/headless/headlessEnvironment.js',
  testMatch: ['<rootDir>/src/**/*.headless.spec.ts'],
  globalSetup:
    '<rootDir>/src/robin/document/tests/headless/globalSetup.ts',
  // sweeps any lane Chrome a killed worker left behind (laneChrome.ts)
  globalTeardown:
    '<rootDir>/src/robin/document/tests/headless/globalTeardown.ts',
  testTimeout: 120000,
  // one Chrome at a time: parallel lane Chromes contend on a laptop and time out
  maxWorkers: 1,
  collectCoverage: false
};

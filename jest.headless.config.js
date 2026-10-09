// Real Chrome covers layout behavior that jsdom cannot represent.
module.exports = {
  displayName: 'headless',
  rootDir: __dirname,
  testEnvironment:
    '<rootDir>/src/assistant/tools/docx/tests/headless/headlessEnvironment.js',
  testMatch: ['<rootDir>/src/**/*.headless.spec.ts'],
  globalSetup:
    '<rootDir>/src/assistant/tools/docx/tests/headless/globalSetup.ts',
  // sweeps any lane Chrome a killed worker left behind (laneChrome.ts)
  globalTeardown:
    '<rootDir>/src/assistant/tools/docx/tests/headless/globalTeardown.ts',
  testTimeout: 120000,
  // one Chrome at a time on a laptop; CI sets FM_LANE_WORKERS=2
  maxWorkers: process.env.FM_LANE_WORKERS
    ? Number(process.env.FM_LANE_WORKERS)
    : 1,
  collectCoverage: false
};

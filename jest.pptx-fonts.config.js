// Isolated Chrome lane: real font decoding, selection, and text layout.
module.exports = {
  displayName: 'pptx-fonts',
  rootDir: __dirname,
  modulePathIgnorePatterns: ['<rootDir>/.kiwi/'],
  testEnvironment:
    '<rootDir>/src/assistant/tools/docx/tests/headless/headlessEnvironment.js',
  testMatch: [
    '<rootDir>/src/elements/components/PptxEditor/tests/font-parity/*.headless.spec.ts'
  ],
  globalSetup:
    '<rootDir>/src/elements/components/PptxEditor/tests/font-parity/build.cjs',
  testTimeout: 120000,
  maxWorkers: 1
};

import { EJ2_VERSION } from './constants';

// Production loads the CDN at EJ2_VERSION; tests and the engine-internal
// patches run against the node_modules copy — the guarantees hold only while
// both are the SAME version, so bump package.json and constants.ts together.
it('CDN-pinned Syncfusion version matches the installed package', () => {
  const installed =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@syncfusion/ej2-documenteditor/package.json').version;
  expect(EJ2_VERSION).toBe(installed);
});

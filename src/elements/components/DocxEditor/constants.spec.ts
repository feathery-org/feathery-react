import { EJ2_VERSION } from './constants';

// Production loads Syncfusion from the CDN at EJ2_VERSION; tests (and the
// research behind every engine-internal patch — handleAcceptReject,
// checkRevisionType, renderTextElementBox, isRevisionMatched, ...) run
// against the node_modules copy. Those guarantees only hold while the two
// are the SAME version, so a bump must land in package.json and
// constants.ts together.
it('CDN-pinned Syncfusion version matches the installed package', () => {
  const installed =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@syncfusion/ej2-documenteditor/package.json').version;
  expect(EJ2_VERSION).toBe(installed);
});

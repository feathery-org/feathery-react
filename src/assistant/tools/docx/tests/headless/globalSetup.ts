/** One bundle build per `yarn test:headless` run, before any spec starts. */
import { buildHostBundle } from './buildHostBundle';
import { sweepLaneChrome } from './laneChrome';

export default async function globalSetup(): Promise<void> {
  // a lane Chrome left by an earlier run killed outright goes first
  const swept = sweepLaneChrome();
  if (swept.killed || swept.removed)
    // eslint-disable-next-line no-console
    console.log(
      `[headless] swept ${swept.killed} leftover Chrome process(es) and ${swept.removed} profile dir(s)`
    );
  const started = Date.now();
  const page = await buildHostBundle();
  // eslint-disable-next-line no-console
  console.log(
    `[headless] host bundle ready in ${Date.now() - started}ms -> ${page}`
  );
}

/**
 * The headless lane's setup, once per `yarn test:headless` run, before any spec starts: a lane
 * Chrome left by an earlier run killed outright goes first. Each engine spec builds its own page.
 */
import { sweepLaneChrome } from './laneChrome';

export default async function globalSetup(): Promise<void> {
  const swept = sweepLaneChrome();
  if (swept.killed || swept.removed)
    // eslint-disable-next-line no-console
    console.log(
      `[headless] swept ${swept.killed} leftover Chrome process(es) and ${swept.removed} profile dir(s)`
    );
}

/**
 * The headless lane's setup, once per `yarn test:headless` run, before any spec starts: a lane
 * Chrome left by an earlier run killed outright goes first. Each engine spec builds its own page.
 */
import fs from 'fs';
import path from 'path';
import { sweepLaneChrome } from './laneChrome';

// The assistant's lane (until it is retired) builds its host page in its own setup.
const ASSISTANT_SETUP = path.join(
  __dirname,
  '../../../../assistant/tools/docx/tests/headless/globalSetup.ts'
);

export default async function globalSetup(): Promise<void> {
  const swept = sweepLaneChrome();
  if (swept.killed || swept.removed)
    // eslint-disable-next-line no-console
    console.log(
      `[headless] swept ${swept.killed} leftover Chrome process(es) and ${swept.removed} profile dir(s)`
    );
  if (fs.existsSync(ASSISTANT_SETUP))
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await require(ASSISTANT_SETUP).default();
}

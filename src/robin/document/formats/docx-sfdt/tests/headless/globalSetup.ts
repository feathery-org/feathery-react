/**
 * The lane's setup as this format runs it: the core lane setup, then the assistant's own docx lane
 * setup (its host page build) while that lane exists; it goes with the assistant at cutover.
 */
import fs from 'fs';
import path from 'path';
import laneSetup from '../../../../tests/headless/globalSetup';

const ASSISTANT_SETUP = path.join(
  __dirname,
  '../../../../../../assistant/tools/docx/tests/headless/globalSetup.ts'
);

// loaded with this module, while jest's transpiling require hook is installed
const assistantSetup: (() => Promise<void>) | null = fs.existsSync(
  ASSISTANT_SETUP
)
  ? // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(ASSISTANT_SETUP).default
  : null;

export default async function globalSetup(): Promise<void> {
  await laneSetup();
  if (assistantSetup) await assistantSetup();
}

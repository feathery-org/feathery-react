/** One bundle build per `yarn test:headless` run, before any spec starts. */
import { buildHostBundle } from './buildHostBundle';

export default async function globalSetup(): Promise<void> {
  const started = Date.now();
  const page = await buildHostBundle();
  // eslint-disable-next-line no-console
  console.log(
    `[headless] host bundle ready in ${Date.now() - started}ms -> ${page}`
  );
}

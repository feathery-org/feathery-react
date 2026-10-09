/** After the lane: no lane Chrome survives, whatever killed a worker, and no lane profile stays. */
import { sweepLaneChrome } from './laneChrome';

export default async function globalTeardown(): Promise<void> {
  const { killed, removed } = sweepLaneChrome();
  if (killed || removed)
    // eslint-disable-next-line no-console
    console.log(
      `[headless] swept ${killed} leftover Chrome process(es) and ${removed} profile dir(s)`
    );
}

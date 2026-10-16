import fs from 'fs';
import { HeadlessSession, startHeadless } from './headlessSession';

describe('multiple cached document performance', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });
  it('keeps only the active history preview engine while retaining draft editors', async () => {
    const sfdt = JSON.stringify({
      sections: [
        {
          blocks: Array.from({ length: 180 }, (_, i) => ({
            inlines: [
              {
                text:
                  `Paragraph ${i}: ` +
                  'Document performance fixture with repeated editable content. '.repeat(
                    5
                  )
              }
            ]
          }))
        }
      ]
    });
    const rows: any[] = [];
    for (const count of [1, 2, 5]) {
      const fixtures = process.env.DOCX_PERF_FIXTURES?.split(',').map((path) =>
        fs.readFileSync(path, 'utf8')
      );
      const open = await session.call(
        'openPerformanceDocuments',
        fixtures ?? sfdt,
        count,
        !!process.env.DOCX_PERF_FIXTURES
      );
      const previews = await session.call('measurePerformancePreviews');
      const profiler = await session.page.createCDPSession();
      await profiler.send('HeapProfiler.collectGarbage');
      const { JSHeapUsedSize: previewHeapBytes } = await session.page.metrics();
      await profiler.detach();
      const typing = await session.call('measurePerformanceTyping');
      rows.push({ count, ...open, ...previews, previewHeapBytes, ...typing });
      await session.call('closePerformanceDocuments');
    }
    if (process.env.DOCX_PERF_OUTPUT)
      fs.writeFileSync(
        process.env.DOCX_PERF_OUTPUT,
        JSON.stringify(rows, null, 2)
      );
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(rows));
    expect(rows.map((row) => row.previews)).toEqual([1, 1, 1]);
  }, 120000);
  it('computes identical history off the UI thread while timers keep responding', async () => {
    const result = await session.call('measureHistoryWorker');
    if (process.env.DOCX_WORKER_OUTPUT)
      fs.writeFileSync(
        process.env.DOCX_WORKER_OUTPUT,
        JSON.stringify(result, null, 2)
      );
    expect(result.identical).toBe(true);
    expect(result.workerConstructions).toBeGreaterThan(0);
    expect(result.direct.ticksDuringCalculation).toBe(0);
    expect(result.worker.ticksDuringCalculation).toBeGreaterThan(0);
    expect(result.changeCount).toBeGreaterThan(0);
  });
});

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
  it('reuses saved version data when flipping versions and revisiting the second document', async () => {
    const sfdt = process.env.DOCX_HISTORY_FIXTURE
      ? fs.readFileSync(process.env.DOCX_HISTORY_FIXTURE, 'utf8')
      : JSON.stringify({
          sections: [
            {
              blocks: Array.from({ length: 180 }, (_, i) => ({
                inlines: [
                  { text: `Paragraph ${i} ` + 'Document content. '.repeat(30) }
                ]
              }))
            }
          ]
        });
    await session.call('openPerformanceDocuments', sfdt, 2);
    try {
      const rows = await session.call('measureVersionSwitches', sfdt);
      if (process.env.DOCX_HISTORY_OUTPUT)
        fs.writeFileSync(
          process.env.DOCX_HISTORY_OUTPUT,
          JSON.stringify(rows, null, 2)
        );
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(rows));
      expect(rows.map((row: any) => row.fetches)).toEqual([1, 2, 2, 2, 2]);
    } finally {
      await session.call('closePerformanceDocuments');
    }
  }, 120000);
  it('keeps overflowing document tabs and their dropdown inside a narrow viewport', async () => {
    await session.page.setViewport({ width: 320, height: 700 });
    await session.call('openOverflowDocuments', 320);
    try {
      await session.page.waitForSelector('[aria-label="More documents"]');
      const row = await session.page.evaluate(() => {
        const list = document.querySelector('[role="tablist"]')!;
        const more = document.querySelector('[aria-label="More documents"]')!;
        return {
          tabs: list.children.length,
          right: more.getBoundingClientRect().right,
          scrollWidth: list.scrollWidth,
          width: list.clientWidth
        };
      });
      expect(row.tabs).toBe(1);
      expect(row.right).toBeLessThanOrEqual(320);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.width);
      await session.page.click('[aria-label="More documents"]');
      await session.page.waitForSelector('[role="menu"]');
      await session.page.keyboard.press('End');
      await session.page.keyboard.press('Enter');
      await session.page.waitForFunction(() =>
        document
          .querySelector('[aria-selected="true"]')
          ?.textContent?.includes('Document 20')
      );
      await session.page.click('[aria-label="More documents"]');
      const menu = await session.page.$eval('[role="menu"]', (el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          height: r.height,
          scrollHeight: el.scrollHeight
        };
      });
      expect(menu.left).toBeGreaterThanOrEqual(0);
      expect(menu.right).toBeLessThanOrEqual(320);
      expect(menu.height).toBeLessThanOrEqual(330);
      expect(menu.scrollHeight).toBeGreaterThan(menu.height);
      if (process.env.DOCX_OVERFLOW_SCREENSHOT)
        await session.page.screenshot({
          path: process.env.DOCX_OVERFLOW_SCREENSHOT
        });
    } finally {
      await session.call('closePerformanceDocuments');
      await session.page.setViewport({ width: 1440, height: 1000 });
    }
  });
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

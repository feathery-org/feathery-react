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
  it('normalizes compact Original before grouped history and reuses it across selections', async () => {
    const original = JSON.stringify({
      optimizeSfdt: true,
      sec: [
        {
          b: Array.from({ length: 20 }, (_, i) => ({
            i: [{ tlp: `Unchanged paragraph ${i}` }]
          }))
        }
      ]
    });
    const requests: string[] = [];
    const requested = (request: any) => {
      if (request.url().includes('unused.invalid'))
        requests.push(request.url());
    };
    session.page.on('request', requested);
    try {
      const result = await session.call(
        'measureCompactOriginalGroup',
        original
      );
      const grouped = result.rows.filter(
        (row: any) => row.version !== 'compact-original'
      );
      expect(grouped).toHaveLength(2);
      for (const row of grouped) {
        expect(row.degraded).toBe(false);
        expect(row.editCount).toBeLessThanOrEqual(3);
        expect(row.highlightedCharacters).toBeLessThanOrEqual(10);
        expect(row.activeContainers).toBe(1);
      }
      for (const row of result.rows) {
        expect(row.events).toEqual([
          expect.objectContaining({
            id: row.version,
            degraded: row.degraded
          })
        ]);
      }
      expect(grouped[1].constructions).toBe(grouped[0].constructions);
      expect(result.originalFetches).toBe(1);
      expect(result.remainingContainers).toBe(0);
      expect(requests).toHaveLength(0);
    } finally {
      session.page.off('request', requested);
    }
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
  it('saves second-document diffs and displays highlights across repeated version selections', async () => {
    const sfdt = process.env.DOCX_HISTORY_FIXTURE
      ? fs.readFileSync(process.env.DOCX_HISTORY_FIXTURE, 'utf8')
      : JSON.stringify({
          sections: [{ blocks: [{ inlines: [{ text: 'Test document' }] }] }]
        });
    await session.call('openPerformanceDocuments', sfdt, 2, true);
    try {
      const saved = await session.call('measureSecondDocumentSave');
      expect(saved.artifacts).toHaveLength(1);
      expect(saved.artifacts[0]).toMatchObject({
        document: 1,
        changes: true,
        start: true
      });
      const rows = await session.call(
        'measureVersionSwitches',
        sfdt,
        true,
        process.env.DOCX_HISTORY_CHANGES
          ? JSON.parse(
              fs.readFileSync(process.env.DOCX_HISTORY_CHANGES, 'utf8')
            )
          : null
      );
      expect(rows.map((row: any) => row.fetches)).toEqual([2, 4, 4, 4, 4]);
      for (const row of rows) {
        expect(row.degraded).toBe(false);
        expect(row.editCount).toBeGreaterThan(0);
        expect(row.revisions).toBeGreaterThan(0);
      }
      if (process.env.DOCX_DIFF_OUTPUT)
        fs.writeFileSync(
          process.env.DOCX_DIFF_OUTPUT,
          JSON.stringify({ saved, rows }, null, 2)
        );
    } finally {
      await session.call('closePerformanceDocuments');
    }
  }, 120000);

  it('keeps overflowing document tabs and their dropdown inside a narrow viewport', async () => {
    await session.page.setViewport({ width: 320, height: 700 });
    await session.call('dismissTrialNotice');
    await session.call('openOverflowDocuments', 320);
    try {
      await session.page.waitForSelector('[aria-label="More documents"]');
      const row = await session.page.evaluate(() => {
        const list = globalThis.document.querySelector('[role="tablist"]')!;
        const more = globalThis.document.querySelector(
          '[aria-label="More documents"]'
        )!;
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
        globalThis.document
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

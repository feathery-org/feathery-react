/* eslint-disable no-restricted-globals -- evaluate callbacks run in Chrome, without imported helpers. */
import fs from 'fs';
import path from 'path';
import os from 'os';
import puppeteer, { Browser, Page } from 'puppeteer-core';

const root = path.resolve(__dirname, '../../../../../..');
const evidence = path.join(root, '.headless-evidence/pptx-fonts');
let browser: Browser;
let page: Page;
let profile: string;

const fixture = (name = 'marketing-fonts.pptx') =>
  fs.readFileSync(path.join(__dirname, '../fixtures', name)).toString('base64');
const call = (method: string, ...args: any[]): Promise<any> =>
  page.evaluate(
    (name, values) => (window as any).pptxFonts[name].apply(null, values),
    method,
    args
  );

beforeAll(async () => {
  const executablePath = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].find((candidate) => candidate && fs.existsSync(candidate));
  if (!executablePath)
    throw new Error(
      'Install Chrome or set CHROME_PATH. This lane requires real font rendering.'
    );
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-fonts-'));
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: profile,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  page = await browser.newPage();
  const bootErrors: string[] = [];
  page.on('pageerror', (error) => bootErrors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  // External fonts must never rescue a missing/invalid embedded face.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url() === 'http://pptx-fonts.test/')
      return request.respond({
        contentType: 'text/html',
        body: '<html><head></head><body style="margin:0"></body></html>'
      });
    else if (/^https?:/.test(request.url())) return request.abort();
    else return request.continue();
  });
  // An intercepted test origin gives the real SDK access to browser storage.
  // No server or network connection is used.
  await page.goto('http://pptx-fonts.test/');
  await page.addScriptTag({
    path: path.join(root, '.headless-build/pptx-fonts/bundle.js')
  });
  if (!(await page.evaluate(() => Boolean((window as any).pptxFonts))))
    throw new Error(
      `PPTX browser harness failed to boot: ${bootErrors.join('\n')}`
    );
  fs.mkdirSync(evidence, { recursive: true });
});

afterAll(async () => {
  await browser?.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});

it.each([
  [2, '1400', 715050, 178800, 1, 900],
  [2, '1400', 715050, 178800, 2, 540],
  [3, 'chrome-l-2', 2780034, 981753.5, 1, 900],
  [3, 'chrome-l-2', 2780034, 981753.5, 2, 540]
] as const)(
  'paints slide %s ellipse %s at radii %s/%s, DPR %s, width %s',
  async (number, id, rx, ry, dpr, width) => {
    await page.setViewport({
      width: 1280,
      height: 800,
      deviceScaleFactor: dpr
    });
    await call('open', fixture('shape-parity-3.pptx'));
    await call('slide', number, width);
    const selector = `[data-shape-id="${id}"] ellipse`;
    const clip = await page.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return {
        x: Math.floor(r.x) - 2,
        y: Math.floor(r.y) - 2,
        width: Math.ceil(r.width) + 4,
        height: Math.ceil(r.height) + 4
      };
    });
    const before = await page.screenshot({ clip });
    fs.writeFileSync(
      path.join(evidence, `ellipse-${id}-${dpr}-actual.png`),
      before
    );
    // Independent reference: same OOXML ellipse, expressed in CSS pixels.
    await page.$eval(
      selector,
      (e, { rx, ry }) => {
        e.setAttribute('cx', String(rx / 9525));
        e.setAttribute('cy', String(ry / 9525));
        e.setAttribute('rx', String(rx / 9525));
        e.setAttribute('ry', String(ry / 9525));
        e.setAttribute('stroke-width', '1');
        e.setAttribute('transform', 'scale(9525)');
      },
      { rx, ry }
    );
    const reference = await page.screenshot({ clip });
    fs.writeFileSync(
      path.join(evidence, `ellipse-${id}-${dpr}-reference.png`),
      reference
    );
    const difference = await call(
      'pixelDifference',
      Buffer.from(before).toString('base64'),
      Buffer.from(reference).toString('base64')
    );
    expect(difference).toBeLessThan(0.001);
  }
);

it('keeps workshop text visible through a full editor refresh', async () => {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await call('open', fixture('shape-parity-6.pptx'));
  await call('slide', 1, 900);
  const before = await page.screenshot();
  await call('refresh', 1);
  const after = await page.screenshot();
  expect(
    await call(
      'pixelDifference',
      Buffer.from(before).toString('base64'),
      Buffer.from(after).toString('base64')
    )
  ).toBeLessThan(0.0001);
});

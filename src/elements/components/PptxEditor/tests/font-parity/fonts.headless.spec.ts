/* eslint-disable no-restricted-globals -- evaluate callbacks run in Chrome, without imported helpers. */
import fs from 'fs';
import path from 'path';
import os from 'os';
import puppeteer, { Browser, Page, CDPSession } from 'puppeteer-core';

const root = path.resolve(__dirname, '../../../../../..');
const evidence = path.join(root, '.headless-evidence/pptx-fonts');
let browser: Browser;
let page: Page;
let cdp: CDPSession;
let profile: string;

const fixture = (name = 'marketing-fonts.pptx') =>
  fs.readFileSync(path.join(__dirname, '../fixtures', name)).toString('base64');
const call = (method: string, ...args: any[]): Promise<any> =>
  page.evaluate(
    (name, values) => (window as any).pptxFonts[name].apply(null, values),
    method,
    args
  );

async function renderedFonts(selector: string) {
  const { root: document } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: document.nodeId,
    selector
  });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts.filter((font) => font.glyphCount > 0);
}

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
  cdp = await page.createCDPSession();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  fs.mkdirSync(evidence, { recursive: true });
});

afterAll(async () => {
  await browser?.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});

it.each([false, true])(
  'renders every embedded family/weight/style with its real face (round trip: %s)',
  async (roundTrip) => {
    const result = await call('open', fixture(), roundTrip);
    expect(result.slides).toBe(28);
    // The 24 package parts contain repeated bold variants: 16 distinct faces.
    expect(result.faces).toHaveLength(16);
    expect(result.faces.every((face: any) => face.status === 'loaded')).toBe(
      true
    );
    const suffix: Record<number, string> = {
      400: 'Regular',
      500: 'Medium',
      600: 'SemiBold',
      700: 'Bold'
    };
    for (const family of ['Nunito Sans', 'Poppins']) {
      for (const weight of [400, 500, 600, 700]) {
        for (const italic of [false, true]) {
          await call('probe', family, weight, italic);
          const faces = await renderedFonts('#probe');
          expect(faces).toHaveLength(1);
          expect(faces[0].isCustomFont).toBe(true);
          const face =
            weight === 400 && italic
              ? 'Italic'
              : suffix[weight] + (italic ? 'Italic' : '');
          expect(faces[0].postScriptName).toBe(
            `${family.replace(/ /g, '')}-${face}`
          );
        }
      }
    }
  }
);

it('uses embedded faces in the real slide text and records layout evidence for all 28 slides', async () => {
  await call('open', fixture());
  const slides = [];
  for (let slide = 1; slide <= 28; slide++) {
    const runs = await call('slide', slide);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const faces = await renderedFonts(`#${run.id}`);
      expect(faces.length).toBeGreaterThan(0);
      expect(faces.every((face) => face.isCustomFont)).toBe(true);
      const family = run.family.includes('Nunito Sans')
        ? 'NunitoSans'
        : 'Poppins';
      const suffix: Record<string, string> = {
        '400': 'Regular',
        '500': 'Medium',
        '600': 'SemiBold',
        '700': 'Bold'
      };
      const variant =
        run.weight === '400' && run.style === 'italic'
          ? 'Italic'
          : suffix[run.weight] + (run.style === 'italic' ? 'Italic' : '');
      expect(faces.map((face) => face.postScriptName)).toEqual([
        `${family}-${variant}`
      ]);
      run.renderedFonts = faces;
      expect(run.rects.length).toBeGreaterThan(0);
    }
    slides.push({ slide, runs });
    if ([6, 7, 12, 14].includes(slide))
      await page.screenshot({
        path: path.join(evidence, `slide-${slide}.png`)
      });
  }
  // Diagnostic measurements, NOT an approved PowerPoint visual baseline.
  fs.writeFileSync(
    path.join(evidence, 'layout.json'),
    JSON.stringify(slides, null, 2)
  );
  // Match the native reference capture's 1140px canvas for raster diagnostics.
  for (const slide of [6, 7, 12, 14]) {
    await call('slide', slide, 1140);
    await page.screenshot({
      path: path.join(evidence, `slide-${slide}-native-scale.png`),
      clip: { x: 0, y: 0, width: 1140, height: 641 }
    });
  }
});

it('detects missing embedded fonts instead of accepting a matching CSS family string', async () => {
  // Deliberately fontless control: same slide XML, zero embedded binaries.
  const result = await call('open', fixture('marketing-parity.pptx'));
  expect(result.faces).toHaveLength(0);
  await call('probe', 'Nunito Sans', 400, false);
  const faces = await renderedFonts('#probe');
  expect(faces.length).toBeGreaterThan(0);
  expect(faces.some((face) => face.isCustomFont)).toBe(false);
});

const nativeRegions = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../fixtures/native-text/regions.json'),
    'utf8'
  )
);

function lineCenters(rows: number[]): number[] {
  const threshold = Math.max(...rows) * 0.08;
  const groups: number[][] = [];
  rows.forEach((ink, row) => {
    if (ink <= threshold) return;
    let group = groups[groups.length - 1];
    // Join dots/ascenders belonging to one line, not the next line.
    if (!group || row - group[group.length - 1] > 4) {
      group = [];
      groups.push(group);
    }
    group.push(row);
  });
  return groups.map(
    (group) =>
      group.reduce((sum, y) => sum + y * rows[y], 0) /
      group.reduce((sum, y) => sum + rows[y], 0)
  );
}

it.each(nativeRegions.map((region: any) => [region.file, region]))(
  'matches native text placement: %s',
  async (_name, region) => {
    await call('open', fixture());
    await call('slide', region.slide, 1140);
    const actual = await page.screenshot({ clip: region.rect });
    const expected = fs.readFileSync(
      path.join(__dirname, '../fixtures/native-text', region.file)
    );
    const expectedRows = await call(
      'inkRows',
      expected.toString('base64'),
      region.color
    );
    const actualRows = await call(
      'inkRows',
      Buffer.from(actual).toString('base64'),
      region.color
    );
    const expectedLines = lineCenters(expectedRows);
    const actualLines = lineCenters(actualRows);
    expect(actualLines).toHaveLength(expectedLines.length);
    // Native screenshots use JPEG and CoreGraphics; Chrome uses PNG and Skia.
    // Compare line centers, allowing sub-two-pixel rasterization differences.
    const offsets = actualLines.map((y, i) => y - expectedLines[i]);
    fs.writeFileSync(path.join(evidence, region.file), actual);
    fs.writeFileSync(
      path.join(evidence, region.file + '.json'),
      JSON.stringify({ expectedLines, actualLines, offsets }, null, 2)
    );
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(1.75);
    if (region.slide === 6) {
      const sum = (rows: number[]) =>
        rows.reduce((total, row) => total + row, 0);
      // Catch artificial emboldening as well as missing/light fallback faces.
      expect(sum(actualRows) / sum(expectedRows)).toBeGreaterThan(0.9);
      expect(sum(actualRows) / sum(expectedRows)).toBeLessThan(1.1);
    }
  }
);

it('also renders the existing Template 1 compressed Inter fixture with its embedded face', async () => {
  const result = await call('open', fixture('template1-text-group.pptx'));
  expect(result.faces).toHaveLength(1);
  expect(result.faces[0].status).toBe('loaded');
  await call('probe', 'Inter', 400, false);
  const faces = await renderedFonts('#probe');
  expect(faces).toHaveLength(1);
  expect(faces[0].isCustomFont).toBe(true);
  expect(faces[0].postScriptName).toMatch(/^Inter/);
});

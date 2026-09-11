/**
 * Launches a headless Chromium against a SYSTEM Chrome through
 * `puppeteer-core`, loads `host.html`, and hands the spec a thin typed handle on
 * the in-page engine surface (`hostEntry.ts`).
 *
 * No download, no bundled browser, no server: the page is loaded over `file://`
 * and the only new dependency is `puppeteer-core`. Node 18+ is required, which
 * `puppeteer-core@23` already gates; the repo runs Node 22 locally.
 *
 * This never attaches to an already-running browser. It always launches its own
 * throwaway profile, so a headed Chrome a human is driving is untouched.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Browser, Page } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';
import { HOST_PAGE } from './buildHostBundle';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
];

export function resolveChrome(): string {
  const candidates = [process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(
    Boolean
  ) as string[];
  for (const candidate of candidates)
    if (fs.existsSync(candidate)) return candidate;
  throw new Error(
    'no system Chrome found for the headless lane - install Google Chrome (https://google.com/chrome) or set CHROME_PATH to a Chrome/Chromium binary'
  );
}

export interface HeadlessSession {
  browser: Browser;
  page: Page;
  /** Call an in-page engine entry point by name; arguments are structured-cloned. */
  call<T = any>(method: string, ...args: any[]): Promise<T>;
  close(): Promise<void>;
}

/**
 * Read a lane fixture from the corpus's `browser-only/` subdirectory.
 *
 * The subdirectory is load-bearing, not tidiness: `corpusShapes()` sweeps every
 * `*.sfdt.json` sitting DIRECTLY in `corpus/`, and the jsdom sweeps that consume
 * it would hang forever on a document with header and footer stories. A
 * browser-only shape must therefore never be a direct child of `corpus/`.
 */
export function readFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'corpus', 'browser-only', name),
    'utf8'
  );
}

/**
 * Where the lane writes a screenshot of each settled state.
 *
 * Gitignored on purpose: it is evidence of a run, not an artifact of the
 * branch. A PR-viewable copy would have to be committed, and this repo pins
 * `store_in_repo: false`.
 */
export const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../../../../.headless-evidence'
);

/**
 * Photograph the laid-out page at a settled state and return the path.
 *
 * The point is not decoration. Every other measurement in this lane reads the
 * SERIALIZED document, and a serialize can be right while the page a human
 * looks at is wrong - a split whose second table renders on top of the first,
 * a fragment that lays out with no rows. This is the only assertion-adjacent
 * artifact that can catch that, and it costs one file per settled state.
 */
export async function shoot(
  session: HeadlessSession,
  name: string,
  focusText?: string
): Promise<string> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  // A trial build's modal sits over the document, and page one of this
  // proposal is a title page - so a raw viewport shot of a split would show
  // neither the dialog's fault nor the split's rows. Clear the furniture, put
  // the rows under test on screen, and photograph the editor itself.
  await session.call('dismissTrialNotice');
  if (focusText) await session.call('focus', focusText);
  const host = await session.page.$('#fm-editor');
  if (host) await host.screenshot({ path: file });
  else await session.page.screenshot({ path: file });
  return file;
}

export async function startHeadless(): Promise<HeadlessSession> {
  if (!fs.existsSync(HOST_PAGE))
    throw new Error(
      `the headless host page is missing at ${HOST_PAGE} - run through "yarn test:headless" so globalSetup builds it`
    );
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-headless-')),
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--hide-scrollbars',
      // A headless tab is never foregrounded, so without these the renderer
      // throttles timers and withholds animation frames and layout never settles.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  let page: Page;
  const failures: string[] = [];
  try {
    page = await browser.newPage();
    // Taller than the 900x700 editor host so an element screenshot of it is
    // never clipped by the viewport.
    await page.setViewport({ width: 1200, height: 1000 });
    page.on('pageerror', (error: Error) => failures.push(String(error)));
    await page.goto(`file://${HOST_PAGE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).fmHeadlessReady === true, {
      timeout: 30000
    });
  } catch (error) {
    await browser.close();
    throw new Error(
      `the host page failed to boot: ${String(error)}${
        failures.length ? `\n${failures.join('\n')}` : ''
      }`
    );
  }
  return {
    browser,
    page,
    // `apply`, not spread: this function body is compiled by babel and then
    // shipped as source into a page that has no babel helpers, so a spread
    // would arrive as an undefined `_toConsumableArray` reference.
    call: <T>(method: string, ...args: any[]): Promise<T> =>
      page.evaluate(
        function (name: string, callArgs: any[]) {
          return (window as any).fmHeadless[name].apply(null, callArgs);
        },
        method,
        args
      ) as Promise<T>,
    close: async () => {
      await browser.close();
    }
  };
}

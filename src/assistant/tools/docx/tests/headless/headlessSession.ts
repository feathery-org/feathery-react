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

function resolveChrome(): string {
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

// Header/footer fixtures hang jsdom and must remain in browser-only.
export function readFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'corpus', 'browser-only', name),
    'utf8'
  );
}

const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../../../../.headless-evidence'
);

export async function shoot(
  session: HeadlessSession,
  name: string,
  focusText?: string
): Promise<string> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
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
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  let page: Page;
  const failures: string[] = [];
  try {
    page = await browser.newPage();
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

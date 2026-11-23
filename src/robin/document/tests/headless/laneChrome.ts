/**
 * The one way the headless lanes launch Chrome, so none outlives its run.
 *
 * Every lane Chrome gets a profile under os.tmpdir() named `fm-headless-*`. A normal close removes
 * the profile; process exit, SIGINT and SIGTERM SIGKILL every browser this process launched and
 * remove its profile. A worker killed outright (SIGKILL, OOM) cannot run handlers, so the lane's
 * global setup and teardown also sweep (`sweepLaneChrome`): any Chrome whose command line names an
 * `fm-headless-` profile, and every stray profile directory.
 *
 * Memory: new headless, one renderer process, a 2 GB V8 heap ceiling; the editor's whole document
 * lives in one page, and a runaway page must fail fast instead of taking the machine down.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Browser } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';

export const PROFILE_PREFIX = 'fm-headless-';

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

/** The flags every lane Chrome runs with; `extra` adds a spec's own. */
export const LANE_ARGS = [
  '--headless=new',
  '--renderer-process-limit=1',
  '--js-flags=--max-old-space-size=2048',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
];

interface Launched {
  pid: number | undefined;
  profile: string;
}
const launched = new Set<Launched>();

function release(entry: Launched): void {
  if (entry.pid)
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  try {
    fs.rmSync(entry.profile, { recursive: true, force: true });
  } catch {
    // a profile Chrome still holds is swept at teardown
  }
  launched.delete(entry);
}

let handlersInstalled = false;
function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', () => {
    for (const entry of [...launched]) release(entry);
  });
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143]
  ] as const)
    process.on(signal, () => {
      for (const entry of [...launched]) release(entry);
      process.exit(code);
    });
}

/** Launch a lane Chrome; closing the returned browser also removes its profile. */
export async function launchLaneChrome(
  extra: readonly string[] = []
): Promise<Browser> {
  installHandlers();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    // the mode is the explicit --headless=new flag below
    headless: false,
    userDataDir: profile,
    args: [...LANE_ARGS, ...extra]
  });
  const entry: Launched = { pid: browser.process()?.pid, profile };
  launched.add(entry);
  const close = browser.close.bind(browser);
  browser.close = async () => {
    try {
      await close();
    } finally {
      release(entry);
    }
  };
  return browser;
}

/**
 * Kill every Chrome whose command line names a lane profile, and remove every stray lane profile
 * directory. Returns what it found, for the run's log.
 */
export function sweepLaneChrome(): { killed: number; removed: number } {
  let killed = 0;
  let listing = '';
  try {
    listing = execFileSync('ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8'
    });
  } catch {
    listing = '';
  }
  const tmp = fs.realpathSync(os.tmpdir());
  for (const line of listing.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[2];
    if (!command.includes(PROFILE_PREFIX)) continue;
    // only lane browsers: a profile under this machine's temp directory
    const dir = /--user-data-dir=(\S+)/.exec(command)?.[1] ?? '';
    if (!dir.includes(PROFILE_PREFIX)) continue;
    if (!(dir.startsWith(tmp) || dir.startsWith(os.tmpdir()))) continue;
    try {
      process.kill(Number(m[1]), 'SIGKILL');
      killed += 1;
    } catch {
      // gone meanwhile
    }
  }
  let removed = 0;
  for (const name of fs.readdirSync(os.tmpdir()))
    if (name.startsWith(PROFILE_PREFIX)) {
      try {
        fs.rmSync(path.join(os.tmpdir(), name), {
          recursive: true,
          force: true
        });
        removed += 1;
      } catch {
        // in use; the next sweep takes it
      }
    }
  return { killed, removed };
}

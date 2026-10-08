/**
 * The engine's headless lane: builds the in-page bundle (webpack and the jest babel config, as
 * the editor's own headless lane does), opens it in system Chrome, and calls the in-page API.
 */
import fs from 'fs';
import path from 'path';
import type { Browser, Page } from 'puppeteer-core';
import { launchLaneChrome } from '../../../../../../assistant/tools/docx/tests/headless/laneChrome';

/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require('webpack');
/* eslint-enable @typescript-eslint/no-var-requires */

const BUILD_DIR = path.resolve(__dirname, '../../../../../../../.headless-build/robin-engine');
const HOST_PAGE = path.join(BUILD_DIR, 'host.html');

export async function buildEngineBundle(): Promise<string> {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const compiler = webpack({
    mode: 'development',
    devtool: false,
    entry: path.join(__dirname, 'engineEntry.ts'),
    output: { path: BUILD_DIR, filename: 'bundle.js' },
    cache: { type: 'filesystem', cacheDirectory: path.join(BUILD_DIR, 'webpack-cache') },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: { loader: 'babel-loader', options: { envName: 'test' } }
        }
      ]
    },
    resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'], fallback: { stream: false } },
    plugins: [
      new webpack.DefinePlugin({
        __PACKAGE_VERSION__: JSON.stringify('headless-lane'),
        __SYNCFUSION_LICENSE_KEY__: JSON.stringify(process.env.SYNCFUSION_LICENSE_KEY || '')
      })
    ],
    performance: { hints: false },
    stats: 'errors-warnings'
  });
  await new Promise<void>((resolve, reject) => {
    compiler.run((error: any, stats: any) => {
      const finish = (failure?: Error) => compiler.close(() => (failure ? reject(failure) : resolve()));
      if (error) return finish(error);
      if (stats?.hasErrors())
        return finish(new Error(`engine bundle failed:\n${stats.toJson({ errors: true }).errors.map((e: any) => e.message).join('\n')}`));
      return finish();
    });
  });
  fs.copyFileSync(path.join(__dirname, 'host.html'), HOST_PAGE);
  return HOST_PAGE;
}

export interface EngineLane {
  call<T = any>(method: string, ...args: any[]): Promise<T>;
  pageErrors: string[];
  /** A CPU profile of the page while `run` executes (for per-verb cost work). */
  profile<T>(run: () => Promise<T>): Promise<{ result: T; profile: unknown }>;
  close(): Promise<void>;
}

export async function startEngineLane(): Promise<EngineLane> {
  const page = await buildEngineBundle();
  // the lane's Chrome launcher: its profile and process never outlive the run
  const browser: Browser = await launchLaneChrome();
  const tab: Page = await browser.newPage();
  await tab.setViewport({ width: 1200, height: 1000 });
  const pageErrors: string[] = [];
  tab.on('pageerror', (error: Error) => pageErrors.push(String(error)));
  await tab.goto(`file://${page}`, { waitUntil: 'load' });
  await tab.waitForFunction(() => (window as any).fmEngineReady === true, { timeout: 60000 });
  const profile = async <T>(run: () => Promise<T>) => {
    const cdp = await tab.target().createCDPSession();
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    const result = await run();
    const { profile: out } = await cdp.send('Profiler.stop');
    await cdp.detach();
    return { result, profile: out as unknown };
  };
  return {
    pageErrors,
    profile,
    call: <T>(method: string, ...args: any[]) =>
      tab.evaluate(
        function (name: string, a: any[]) {
          return (window as any).fmEngine[name].apply(null, a);
        },
        method,
        args
      ) as Promise<T>,
    close: () => browser.close()
  };
}

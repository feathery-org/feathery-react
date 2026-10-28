// Builds the inline content-control exporter-stack lane's page and drives it in system Chrome
import fs from 'fs';
import path from 'path';
import type { Browser, Page } from 'puppeteer-core';
import { launchLaneChrome } from '../../../../../robin/document/tests/headless/laneChrome';

/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require('webpack');
/* eslint-enable @typescript-eslint/no-var-requires */

const BUILD_DIR = path.resolve(
  __dirname,
  '../../../../../../.headless-build/docx-cc-stack'
);
const HOST_PAGE = path.join(BUILD_DIR, 'host.html');

async function buildBundle(): Promise<string> {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const compiler = webpack({
    mode: 'development',
    devtool: false,
    entry: path.join(__dirname, 'ccStackEntry.ts'),
    output: { path: BUILD_DIR, filename: 'bundle.js' },
    cache: {
      type: 'filesystem',
      cacheDirectory: path.join(BUILD_DIR, 'webpack-cache')
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: { loader: 'babel-loader', options: { envName: 'test' } }
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      fallback: { stream: false }
    },
    plugins: [
      new webpack.DefinePlugin({
        __PACKAGE_VERSION__: JSON.stringify('headless-lane'),
        __SYNCFUSION_LICENSE_KEY__: JSON.stringify(
          process.env.SYNCFUSION_LICENSE_KEY || ''
        )
      })
    ],
    performance: { hints: false },
    stats: 'errors-warnings'
  });
  await new Promise<void>((resolve, reject) => {
    compiler.run((error: any, stats: any) => {
      const finish = (failure?: Error) =>
        compiler.close(() => (failure ? reject(failure) : resolve()));
      if (error) return finish(error);
      if (stats?.hasErrors())
        return finish(
          new Error(
            `cc stack bundle failed:\n${stats
              .toJson({ errors: true })
              .errors.map((entry: any) => entry.message)
              .join('\n')}`
          )
        );
      return finish();
    });
  });
  fs.writeFileSync(
    HOST_PAGE,
    '<!doctype html><html><head><meta charset="utf-8"><title>cc stack lane</title></head><body><script src="./bundle.js"></script></body></html>'
  );
  return HOST_PAGE;
}

export interface CcLane {
  page: Page;
  call<T = any>(method: string, ...args: any[]): Promise<T>;
  close(): Promise<void>;
}

export async function startCcLane(): Promise<CcLane> {
  const hostPage = await buildBundle();
  const browser: Browser = await launchLaneChrome();
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000 });
  page.on('pageerror', (error: Error) => console.error('PAGE ERROR', error));
  await page.goto(`file://${hostPage}`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).ccReady === true, {
    timeout: 60000
  });
  return {
    page,
    call: <T>(method: string, ...args: any[]) =>
      page.evaluate(
        function (name: string, a: any[]) {
          return (window as any).cc[name].apply(null, a);
        },
        method,
        args
      ) as Promise<T>,
    close: () => browser.close()
  };
}

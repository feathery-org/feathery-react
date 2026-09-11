/**
 * Builds the headless lane's in-page bundle with the bundler the repo already
 * has (webpack 5 + babel-loader, the same babel config `jest` uses), so the lane
 * adds no build framework. Output is a single dev-mode, unminified IIFE beside a
 * copy of `host.html`, plus a webpack filesystem cache so re-runs are cheap.
 */
import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require('webpack');
/* eslint-enable @typescript-eslint/no-var-requires */

export const HEADLESS_BUILD_DIR = path.resolve(
  __dirname,
  '../../../../../../.headless-build'
);

export const HOST_PAGE = path.join(HEADLESS_BUILD_DIR, 'host.html');

export async function buildHostBundle(): Promise<string> {
  fs.mkdirSync(HEADLESS_BUILD_DIR, { recursive: true });
  const compiler = webpack({
    mode: 'development',
    devtool: false,
    entry: path.join(__dirname, 'hostEntry.ts'),
    output: { path: HEADLESS_BUILD_DIR, filename: 'bundle.js' },
    cache: {
      type: 'filesystem',
      cacheDirectory: path.join(HEADLESS_BUILD_DIR, 'webpack-cache')
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
            `headless host bundle failed to build:\n${stats
              .toJson({ errors: true })
              .errors.map((entry: any) => entry.message)
              .join('\n')}`
          )
        );
      return finish();
    });
  });

  fs.copyFileSync(path.join(__dirname, 'host.html'), HOST_PAGE);
  return HOST_PAGE;
}

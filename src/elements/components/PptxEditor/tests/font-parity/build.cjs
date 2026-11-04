const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

module.exports = async () => {
  const output = path.resolve(
    __dirname,
    '../../../../../../.headless-build/pptx-fonts'
  );
  fs.mkdirSync(output, { recursive: true });
  const compiler = webpack({
    mode: 'development',
    devtool: false,
    cache: { type: 'filesystem', cacheDirectory: path.join(output, 'cache') },
    entry: path.join(__dirname, 'browser.ts'),
    output: { path: output, filename: 'bundle.js', publicPath: '' },
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: { loader: 'babel-loader', options: { envName: 'test' } }
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      fallback: { stream: false }
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      new webpack.DefinePlugin({
        __PACKAGE_VERSION__: JSON.stringify('font-parity'),
        __SYNCFUSION_LICENSE_KEY__: JSON.stringify('')
      })
    ],
    performance: { hints: false }
  });
  await new Promise((resolve, reject) =>
    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error);
        else if (stats.hasErrors())
          reject(new Error(stats.toString('errors-only')));
        else resolve();
      });
    })
  );
};

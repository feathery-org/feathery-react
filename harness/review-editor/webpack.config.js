// Bundles the harness entry only. Separate from the package build on purpose:
// the review editor's internals are not public API, and a harness is no reason
// to make them so.
const path = require('path');
const webpack = require('webpack');
const base = require('../../webpack.config');
const pkg = require('../../package.json');

module.exports = {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map',
  entry: path.resolve(__dirname, 'entry.tsx'),
  output: {
    path: __dirname,
    filename: 'bundle.js',
    globalObject: 'this'
  },
  plugins: [
    new webpack.DefinePlugin({
      __PACKAGE_VERSION__: JSON.stringify(pkg.version),
      __SYNCFUSION_LICENSE_KEY__: JSON.stringify('')
    })
  ],
  // The package's loaders, so the harness compiles the same way the library
  // does - but with declaration output off. The package tsconfig emits .d.ts
  // files, and a harness build has no business writing them into dist/.
  module: {
    rules: [
      {
        test: /\.(ts|tsx)?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            compilerOptions: { declaration: false, declarationMap: false }
          }
        }
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: ['babel-loader']
      }
    ]
  },
  resolve: base.resolve
};

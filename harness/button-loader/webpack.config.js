// Bundles the harness entry only. Separate from the package build on purpose:
// this renders internal components a form never exposes, and a harness is no
// reason to make them public API.
const path = require('path');
const base = require('../../webpack.config');

module.exports = {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map',
  entry: path.resolve(__dirname, 'entry.tsx'),
  output: {
    path: __dirname,
    filename: 'bundle.js',
    globalObject: 'this'
  },
  // The package's loaders, so the harness compiles the same way the library
  // does - but with declaration output off, since a harness build has no
  // business writing .d.ts files into dist/.
  module: {
    rules: [
      {
        test: /\.(ts|tsx)?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            // The package ships via rollup + babel, which strips types without
            // checking them, so this matches how the real bundle is built. It
            // also has to: master currently has four unrelated HubActionOptions
            // type errors, and utils/init pulls that file in transitively.
            transpileOnly: true,
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

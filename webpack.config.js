const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const webpack = require('webpack');
const pkg = require('./package.json');
module.exports = {
  entry: './src/index.tsx',
  output: {
    filename: 'index.js',
    chunkFilename: '[name].[contenthash].js',
    globalObject: 'this' /* So window references don't break in NextJS */,
    library: {
      name: 'Feathery',
      type: 'umd'
    }
  },
  plugins: [
    new CleanWebpackPlugin(),
    new webpack.DefinePlugin({
      __PACKAGE_VERSION__: JSON.stringify(pkg.version)
    })
  ],
  module: {
    rules: [
      {
        // .d.ts files get matched by ts
        test: /\.(ts|tsx)?$/,
        exclude: /node_modules/,
        use: 'ts-loader'
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: ['babel-loader']
      }
    ]
  },
  resolve: {
    extensions: ['*', '.js', '.jsx', '.ts', '.tsx', '.d.ts']
  }
};

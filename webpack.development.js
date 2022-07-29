/* eslint-disable @typescript-eslint/no-var-requires */
const config = require('./webpack.config');
const webpack = require('webpack');
const BundleAnalyzerPlugin =
  require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

config.devtool = 'eval-cheap-module-source-map';
config.externals = ['react'];
config.plugins.push(
  new webpack.optimize.LimitChunkCountPlugin({
    maxChunks: 1
  }),
  // Set openAnalyzer to true to view interactive bundle size breakdown
  new BundleAnalyzerPlugin({ defaultSizes: 'stat', openAnalyzer: false })
);

module.exports = config;

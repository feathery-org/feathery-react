const config = require('./webpack.config');
const webpack = require('webpack');

config.devtool = 'eval-cheap-module-source-map';
config.externals = ['react'];
config.plugins.push(
  new webpack.optimize.LimitChunkCountPlugin({
    maxChunks: 1
  })
);

// Uncomment to view interactive bundle size breakdown
// const BundleAnalyzerPlugin =
//   require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
// config.plugins.push(
//   new BundleAnalyzerPlugin({ defaultSizes: 'stat', openAnalyzer: true })
// );

module.exports = config;

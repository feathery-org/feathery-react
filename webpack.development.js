const config = require('./webpack.config');
const webpack = require('webpack');

config.devtool = 'eval-cheap-module-source-map';
config.externals = ['react'];
config.plugins.push(
  new webpack.optimize.LimitChunkCountPlugin({
    maxChunks: 1
  })
);
module.exports = config;

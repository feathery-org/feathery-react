const config = require('./webpack.config');
const webpack = require('webpack');

module.exports = (env) => {
  if (env.analyze) {
    const BundleAnalyzerPlugin =
      require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
    config.plugins.push(
      new BundleAnalyzerPlugin({ defaultSizes: 'stat', openAnalyzer: true })
    );
  }

  config.devtool = 'eval-cheap-module-source-map';
  config.externals = ['react'];
  config.plugins.push(
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    })
  );
  return config;
};

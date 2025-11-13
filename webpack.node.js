const path = require('path');
const nodeExternals = require('webpack-node-externals');
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

  config.externals = [
    'react',
    nodeExternals({ allowlist: ['react-imask', 'imask'] })
  ];

  config.output.path = path.resolve(__dirname, 'dist');
  config.performance = {
    maxEntrypointSize: 1024000,
    maxAssetSize: 1024000
  };
  config.plugins.push(
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    })
  );
  return config;
};

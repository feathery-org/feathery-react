const path = require('path');
const nodeExternals = require('webpack-node-externals');
const config = require('./webpack.config');

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
    maxEntrypointSize: 512000,
    maxAssetSize: 512000
  };
  return config;
};

const path = require('path');
const config = require('./webpack.config');

module.exports = (env) => {
  if (env.analyze) {
    const BundleAnalyzerPlugin =
      require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
    config.plugins.push(
      new BundleAnalyzerPlugin({ defaultSizes: 'stat', openAnalyzer: true })
    );
  }

  config.output.path = path.resolve(__dirname, 'umd');
  config.performance = {
    maxEntrypointSize: 1024000,
    maxAssetSize: 1024000
  };

  return config;
};

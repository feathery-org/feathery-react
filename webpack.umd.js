const path = require('path');
const config = require('./webpack.config');
const {
  WebpackPlugin: BundledPackagesPlugin
} = require('./scripts/release-sbom/bundled-packages.cjs');

module.exports = (env) => {
  if (env.analyze) {
    const BundleAnalyzerPlugin =
      require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
    config.plugins.push(
      new BundleAnalyzerPlugin({ defaultSizes: 'stat', openAnalyzer: true })
    );
  }

  config.plugins.push(new BundledPackagesPlugin('umd'));
  config.output.path = path.resolve(__dirname, 'umd');
  config.performance = {
    maxEntrypointSize: 1024000,
    maxAssetSize: 1024000
  };

  return config;
};

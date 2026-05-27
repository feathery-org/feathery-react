const config = require('./webpack.config');
const webpack = require('webpack');
const path = require('path');

module.exports = (env) => {
  if (env.analyze) {
    const BundleAnalyzerPlugin =
      require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
    config.plugins.push(
      new BundleAnalyzerPlugin({ defaultSizes: 'stat', openAnalyzer: true })
    );
  }

  config.output.path = path.resolve(__dirname, 'dist');

  config.devtool = 'eval-cheap-module-source-map';
  // Externalize the entire React family so a locally-linked (yarn link) build
  // shares the host app's single React/ReactDOM instance. Bundling our own
  // react-dom here causes duplicate-ReactDOM hydration mismatches under SSR
  // (e.g. hosted-forms-next). This mirrors the production rollup externals.
  config.externals = [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime'
  ];
  config.plugins.push(
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    }),
    new webpack.DefinePlugin({
      'process.env.BACKEND_ENV': JSON.stringify(env.BACKEND_ENV || 'production')
    })
  );
  return config;
};

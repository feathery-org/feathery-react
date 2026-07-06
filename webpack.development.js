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

  // Not an eval-based devtool: pdfjs-dist's prebuilt pdf.mjs declares its own
  // top-level `var __webpack_exports__`, and inside a strict-mode eval wrapper
  // that hoisted var shadows webpack's factory parameter, crashing module
  // evaluation with "Object.defineProperty called on non-object".
  config.devtool = 'cheap-module-source-map';
  config.externals = ['react'];
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

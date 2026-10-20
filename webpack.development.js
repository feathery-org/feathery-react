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
  // hosted-forms-next imports this dev bundle during SSR, where there is no
  // `document`. Webpack's handling of `new URL('./x', import.meta.url)`
  // (the PhoneField flag font) emits runtime code that reads
  // document.baseURI / the current <script> URL at module-evaluation time and
  // throws on the server. Leave those URLs untouched in the dev bundle; the
  // font lookup is wrapped in try/catch and degrades gracefully.
  config.output.publicPath = '';
  config.module.parser = { javascript: { url: false } };

  config.devtool = 'eval-cheap-module-source-map';
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

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
  config.output.publicPath = '';
  config.module.parser = {
    ...config.module.parser,
    javascript: {
      ...config.module.parser?.javascript,
      url: 'relative'
    }
  };

  config.devtool = 'eval-cheap-module-source-map';
  config.externals = [
    'react',
    'react-dom',
    'react-dom/client',
    'react-dom/server',
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

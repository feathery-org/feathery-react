const path = require('path');
const config = require('./webpack.config');

config.output.filename = '[name].js';
config.output.path = path.resolve(__dirname, 'umd');
config.performance = {
  maxEntrypointSize: 1024000,
  maxAssetSize: 1024000
};
config.optimization = {
  splitChunks: {
    chunks: 'all'
  }
};

module.exports = config;

const path = require('path');
const nodeExternals = require('webpack-node-externals');
const config = require('./webpack.config');

config.externals = ['react', nodeExternals()];
config.output.path = path.resolve(__dirname, 'dist');
config.performance = {
  maxEntrypointSize: 512000,
  maxAssetSize: 512000
};

module.exports = config;

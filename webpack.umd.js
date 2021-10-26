const path = require('path');
const config = require('./webpack.config');

config.output.path = path.resolve(__dirname, 'umd');
config.performance = {
    maxEntrypointSize: 1024000,
    maxAssetSize: 1024000
};

module.exports = config;

const path = require('path');
const config = require('./webpack.config');

config.output.path = path.resolve(__dirname, 'umd');
config.output.library.export = 'Feathery';
config.performance = {
    maxEntrypointSize: 1024000,
    maxAssetSize: 1024000
};

module.exports = config;

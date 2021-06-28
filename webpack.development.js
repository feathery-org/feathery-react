const config = require('./webpack.config');

config.devtool = 'eval-cheap-module-source-map';
config.externals = ['react'];
module.exports = config;

const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
module.exports = {
    entry: './src/index.js',
    externals: ['react', nodeExternals()],
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist'),
        library: 'Feathery',
        libraryTarget: 'umd'
    },
    plugins: [new CleanWebpackPlugin()],
    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: ['babel-loader']
            },
            {
                test: /\.(scss|css)$/,
                use: ['style-loader', 'css-loader', 'sass-loader'],
                include: path.resolve(__dirname, './src')
            }
        ]
    },
    resolve: {
        extensions: ['*', '.js', '.jsx']
    },
    performance: {
        maxEntrypointSize: 512000,
        maxAssetSize: 512000
    }
};

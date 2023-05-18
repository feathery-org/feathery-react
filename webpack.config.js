const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    filename: 'index.js',
    globalObject: 'this' /* So window references don't break in NextJS */,
    library: {
      name: 'Feathery',
      type: 'umd'
    }
  },
  plugins: [new CleanWebpackPlugin(), new MiniCssExtractPlugin()],
  module: {
    rules: [
      {
        // .d.ts files get matched by ts
        test: /\.(ts|tsx)?$/,
        exclude: /node_modules/,
        use: 'ts-loader'
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: ['babel-loader']
      },
      {
        test: /\.(scss|css)$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
        include: path.resolve(__dirname, './src')
      }
    ]
  },
  resolve: {
    extensions: ['*', '.js', '.jsx', '.ts', '.tsx', '.d.ts']
  }
};

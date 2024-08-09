const { CleanWebpackPlugin } = require('clean-webpack-plugin');

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
  plugins: [new CleanWebpackPlugin()],
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
      }
    ]
  },
  resolve: {
    extensions: ['*', '.js', '.jsx', '.ts', '.tsx', '.d.ts']
  }
};

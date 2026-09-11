// Project-wide Babel config.
//
// This used to live under `babel` in package.json. That form is *file-relative*
// — Babel applies it only to files inside this package — which meant Jest had
// no configuration for the ESM-only `@tanstack/react-table` and
// `@tanstack/table-core` dist files and failed on their `import` statements.
// A root `babel.config.js` applies to everything Jest is allowed to transform
// (see `transformIgnorePatterns` in package.json), which is what lets those
// two packages be compiled to CJS for the test environment.
//
// The bundlers are unaffected: webpack's babel-loader excludes node_modules,
// and rollup's babel plugin passes `configFile: false` with its own presets.
module.exports = {
  presets: [
    '@babel/preset-env',
    '@babel/preset-typescript',
    '@babel/preset-react',
    '@emotion/babel-preset-css-prop'
  ],
  plugins: [['@babel/transform-runtime', { regenerator: true }]],
  env: {
    test: {
      plugins: ['babel-plugin-transform-import-meta']
    }
  }
};

import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import del from 'rollup-plugin-delete';
import copy from 'rollup-plugin-copy';
import replace from '@rollup/plugin-replace';
import babel from '@rollup/plugin-babel';
import { readFileSync } from 'fs';

// Read package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default {
  input: 'src/index.tsx',
  output: [
    {
      dir: 'dist',
      format: 'esm',
      chunkFileNames: 'fthry_[name].[hash].js',
      preserveModules: false
    },
    {
      dir: 'cjs',
      format: 'cjs',
      chunkFileNames: 'fthry_[name].[hash].js',
      exports: 'named'
    }
  ],
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    /^react\//,
    /^react-dom\//,
    'jszip'
  ],
  plugins: [
    del({ targets: ['dist/*', 'cjs/*'] }),
    // Ship the vendored country-flag font beside the bundle. Unlike webpack,
    // rollup leaves `new URL('./TwemojiCountryFlags.woff2', import.meta.url)`
    // as a literal relative reference without emitting the file, so we copy it
    // into each output dir. This keeps the flag font served from our own
    // package/origin instead of the polyfill's default jsDelivr CDN.
    copy({
      targets: [
        {
          src: 'src/elements/fields/PhoneField/TwemojiCountryFlags.woff2',
          dest: ['dist', 'cjs']
        }
      ],
      hook: 'closeBundle',
      copyOnce: true
    }),
    replace({
      preventAssignment: true,
      values: {
        __PACKAGE_VERSION__: JSON.stringify(pkg.version)
      }
    }),
    resolve({
      browser: true,
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    }),
    commonjs(),
    babel({
      include: ['node_modules/@fingerprintjs/fingerprintjs/**'],
      babelHelpers: 'bundled',
      presets: [['@babel/preset-env', { targets: { ie: '11' } }]]
    }),
    typescript({
      tsconfig: './tsconfig.json',
      tsconfigOverride: {
        compilerOptions: {
          declaration: true,
          declarationDir: './dist',
          noEmit: false
        },
        exclude: [
          'node_modules',
          'dist',
          'umd',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          '**/*.spec.tsx'
        ]
      },
      declaration: false
    })
  ]
};

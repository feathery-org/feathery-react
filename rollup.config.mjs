import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import del from 'rollup-plugin-delete';
import copy from 'rollup-plugin-copy';
import replace from '@rollup/plugin-replace';
import babel from '@rollup/plugin-babel';
import { readFileSync } from 'fs';
import path from 'path';

// Read package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default {
  input: {
    index: 'src/index.tsx',
    'thumbnail-renderer': 'src/Form/ThumbnailRenderer.tsx'
  },
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
    // @segment/analytics-next's `browser` field swaps its deprecated Node
    // entry (which drags in node-fetch and breaks the build) for a browser
    // stub. node-resolve only honors that field via the global `browser: true`
    // option, which would also flip every other dependency to its browser
    // variant (e.g. Stripe and react-datepicker to their UMD builds), so scope
    // the swap to just this package.
    {
      name: 'segment-browser-entry',
      resolveId(source, importer) {
        if (
          source === './node' &&
          importer?.includes(`@segment${path.sep}analytics-next`)
        ) {
          return path.resolve(
            'node_modules/@segment/analytics-next/dist/pkg/node/node.browser.js'
          );
        }
        return null;
      }
    },
    resolve({
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

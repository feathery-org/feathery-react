import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import del from 'rollup-plugin-delete';
import copy from 'rollup-plugin-copy';
import replace from '@rollup/plugin-replace';
import babel from '@rollup/plugin-babel';
import { readFileSync } from 'fs';
import path from 'path';
import noNodeBuiltins from './scripts/no-node-builtins.cjs';
import pptxWorkerBuild from './scripts/pptx-worker-bundle.cjs';
import bundledPackages from './scripts/release-sbom/bundled-packages.cjs';

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
      preserveModules: false,
      sourcemap: true
    },
    {
      dir: 'cjs',
      format: 'cjs',
      chunkFileNames: 'fthry_[name].[hash].js',
      exports: 'named',
      sourcemap: true
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
    pptxWorkerBuild.pptxWorkerPlugin(),
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
        __PACKAGE_VERSION__: JSON.stringify(pkg.version),
        // The EJ2 editor validates its license in the browser, so inject the
        // CI/build environment value without committing it to source.
        __SYNCFUSION_LICENSE_KEY__: JSON.stringify(
          process.env.SYNCFUSION_LICENSE_KEY || ''
        )
      }
    }),
    // Some dependencies pick between a Node and a browser entry through their
    // package.json `browser` field. node-resolve only honors that field via
    // the global `browser: true` option, which would also flip every other
    // dependency to its browser variant (e.g. Stripe and react-datepicker to
    // their UMD builds), so swap just these:
    // - @segment/analytics-next's deprecated Node entry drags in node-fetch.
    // - inherits (via @segment/facade) requires Node's `util`.
    {
      name: 'browser-entries',
      resolveId(source, importer) {
        if (
          source === './node' &&
          importer?.includes(`@segment${path.sep}analytics-next`)
        ) {
          return path.resolve(
            'node_modules/@segment/analytics-next/dist/pkg/node/node.browser.js'
          );
        }
        if (source === 'inherits') {
          return path.resolve('node_modules/inherits/inherits_browser.js');
        }
        return null;
      }
    },
    noNodeBuiltins.rollupPlugin(),
    resolve({
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    }),
    commonjs(),
    babel({
      include: ['node_modules/@fingerprintjs/fingerprintjs/**'],
      babelHelpers: 'bundled',
      // The repo's Babel config moved from package.json (file-relative, so it
      // never reached node_modules) to a root babel.config.js that Jest needs
      // in order to transform TanStack's ESM-only dist. Opting out here keeps
      // this transform exactly as it was: preset-env and nothing else.
      configFile: false,
      babelrc: false,
      presets: [['@babel/preset-env', { targets: { ie: '11' } }]]
    }),
    bundledPackages.rollupPlugin('rollup'),
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

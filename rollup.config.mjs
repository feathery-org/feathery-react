import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import del from 'rollup-plugin-delete';
import replace from '@rollup/plugin-replace';
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
    replace({
      preventAssignment: true,
      values: {
        __PACKAGE_VERSION__: JSON.stringify(pkg.version)
      }
    }),
    resolve({
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    }),
    commonjs(),
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

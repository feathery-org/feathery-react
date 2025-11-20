import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import del from 'rollup-plugin-delete';

export default {
  input: 'src/index.tsx',
  output: [
    {
      dir: 'dist',
      format: 'esm',
      chunkFileNames: 'fthry_[name].[hash].js',
      preserveModules: false,
      preserveModulesRoot: 'src'
    }
  ],
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    /^react\//,
    /^react-dom\//
  ],
  plugins: [
    del({ targets: 'dist/*' }),
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

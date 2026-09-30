import type { StorybookConfig } from '@storybook/react-webpack5';
import { createRequire } from 'module';

// main.ts is loaded as ESM, where a bare JSON import needs an import attribute
const pkg = createRequire(import.meta.url)('../package.json');

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(ts|tsx)'],
  addons: [
    // Compiles with the project's root babel.config.js, which carries the
    // emotion css-prop preset every element relies on.
    '@storybook/addon-webpack5-compiler-babel',
    '@storybook/addon-docs'
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {}
  },
  webpackFinal: async (config) => {
    // The builder runs its own copy of webpack, and plugins from the project's
    // copy fail against it, so borrow the DefinePlugin it already registered.
    const DefinePlugin: any = config.plugins?.find(
      (plugin) => plugin?.constructor?.name === 'DefinePlugin'
    )?.constructor;
    config.plugins = [
      ...(config.plugins ?? []),
      // Mirrors webpack.config.js so src/ compiles the same way it does there
      new DefinePlugin({
        __PACKAGE_VERSION__: JSON.stringify(`${pkg.version}-storybook`),
        __SYNCFUSION_LICENSE_KEY__: JSON.stringify('')
      })
    ];
    config.resolve = {
      ...config.resolve,
      fallback: {
        ...config.resolve?.fallback,
        // jszip references Node's stream module but doesn't need it in browser
        stream: false
      }
    };
    return config;
  }
};

export default config;

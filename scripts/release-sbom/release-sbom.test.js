/**
 * @jest-environment node
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { packageRoot, record } = require('./bundled-packages.cjs');
const { consumerPackages, run, scanLayout } = require('./sign.cjs');

describe('packageRoot', () => {
  it('finds unscoped, scoped and nested packages', () => {
    expect(packageRoot('/r/node_modules/date-fns/esm/index.js')).toBe(
      '/r/node_modules/date-fns'
    );
    expect(packageRoot('/r/node_modules/@emotion/react/dist/x.js')).toBe(
      '/r/node_modules/@emotion/react'
    );
    expect(
      packageRoot('/r/node_modules/a/node_modules/@babel/runtime/helpers/x.js')
    ).toBe('/r/node_modules/a/node_modules/@babel/runtime');
  });

  it('strips rollup virtual-module markers and queries', () => {
    expect(packageRoot('\0/r/node_modules/react/index.js?commonjs-proxy')).toBe(
      '/r/node_modules/react'
    );
  });

  it('ignores first-party files and bare node_modules paths', () => {
    expect(packageRoot('/r/src/index.tsx')).toBeNull();
    expect(packageRoot('/r/node_modules/react')).toBeNull();
    expect(packageRoot('/r/node_modules/@emotion/react')).toBeNull();
  });
});

describe('record', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sbom-test-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function install(location, name, version) {
    const root = path.join(dir, location);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name, version })
    );
    return root;
  }

  it('lists each package once, with the version on disk', () => {
    const react = install('node_modules/react', 'react', '18.2.0');
    const helpers = install(
      'node_modules/a/node_modules/@babel/runtime',
      '@babel/runtime',
      '7.20.6'
    );
    record(
      'umd',
      [
        path.join(react, 'index.js'),
        path.join(react, 'cjs/react.production.min.js'),
        `\0${path.join(helpers, 'helpers/esm/extends.js')}?commonjs-module`,
        path.join(dir, 'src/index.tsx')
      ],
      path.join(dir, 'records')
    );
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, 'records/umd.json'), 'utf8')
    );
    expect(written.build).toBe('umd');
    expect(written.packages).toEqual([
      {
        name: '@babel/runtime',
        version: '7.20.6',
        manifest: path.join(helpers, 'package.json')
      },
      {
        name: 'react',
        version: '18.2.0',
        manifest: path.join(react, 'package.json')
      }
    ]);
  });
});

describe('consumerPackages', () => {
  // The shape of npm's package-lock.json after `npm install <tarball>`.
  const lock = {
    packages: {
      '': { dependencies: { '@feathery/react': 'file:pkg.tgz' } },
      'node_modules/@feathery/react': {
        version: '2.0.0',
        dependencies: { 'react-select': '^5', jszip: '^3' },
        peerDependencies: { react: '^18 || ^19', 'react-dom': '^18 || ^19' }
      },
      'node_modules/react-select': {
        version: '5.10.1',
        dependencies: { '@emotion/react': '^11' },
        peerDependencies: { react: '*', 'react-dom': '*' }
      },
      // A peer of a dependency: npm 7+ installs it for the consumer.
      'node_modules/@emotion/react': {
        version: '11.14.0',
        peerDependencies: { react: '*', '@babel/core': '^7' }
      },
      'node_modules/@babel/core': {
        version: '7.29.0',
        dependencies: { semver: '^6' }
      },
      'node_modules/semver': { version: '7.6.0' },
      'node_modules/@babel/core/node_modules/semver': { version: '6.3.1' },
      'node_modules/jszip': { version: '3.10.2' },
      // Our own peers resolve to the consumer's app.
      'node_modules/react': { version: '19.3.1' },
      'node_modules/react-dom': {
        version: '19.3.1',
        dependencies: { scheduler: '^0.28' }
      },
      'node_modules/scheduler': { version: '0.28.0' }
    }
  };

  it('keeps dependencies and their peers, drops our own peers', () => {
    const installed = consumerPackages(lock, '@feathery/react');
    expect([...installed.keys()].sort()).toEqual([
      '@babel/core@7.29.0',
      '@emotion/react@11.14.0',
      '@feathery/react@2.0.0',
      'jszip@3.10.2',
      'react-select@5.10.1',
      'semver@6.3.1'
    ]);
  });

  it('keeps a package reachable both through our peers and otherwise', () => {
    const shared = JSON.parse(JSON.stringify(lock));
    shared.packages['node_modules/jszip'].dependencies = { scheduler: '*' };
    const installed = consumerPackages(shared, '@feathery/react');
    expect(installed.get('scheduler@0.28.0')).toBe('node_modules/scheduler');
    expect(installed.has('react@19.3.1')).toBe(false);
  });

  it('fails when the tarball is not installed', () => {
    expect(() => consumerPackages(lock, '@feathery/other')).toThrow(
      'not installed'
    );
  });
});

describe('scanLayout', () => {
  it('adds inlined packages once each, as package roots', () => {
    const installed = new Map([
      ['jszip@3.10.2', 'node_modules/jszip'],
      ['date-fns@4.1.0', 'node_modules/date-fns']
    ]);
    const bundled = new Map([
      ['date-fns@4.1.0', { name: 'date-fns', manifest: '/r/a/package.json' }],
      ['react@18.2.0', { name: 'react', manifest: '/r/b/package.json' }],
      [
        '@babel/runtime@7.20.6',
        { name: '@babel/runtime', manifest: '/r/c/package.json' }
      ]
    ]);
    expect(scanLayout(installed, bundled)).toEqual([
      { source: 'node_modules/jszip', directory: 'node_modules/jszip' },
      { source: 'node_modules/date-fns', directory: 'node_modules/date-fns' },
      {
        manifest: '/r/b/package.json',
        directory: 'bundled/react@18.2.0/node_modules/react'
      },
      {
        manifest: '/r/c/package.json',
        directory: 'bundled/@babel/runtime@7.20.6/node_modules/@babel/runtime'
      }
    ]);
  });
});

describe('run', () => {
  it('names the cause when the command cannot start', () => {
    expect(() => run('release-sbom-missing-command', ['script.py'])).toThrow(
      'could not run release-sbom-missing-command: spawnSync release-sbom-missing-command ENOENT'
    );
  });

  it('names the command when it exits non-zero', () => {
    expect(() => run(process.execPath, ['-e', 'process.exit(3)'])).toThrow(
      'node -e failed'
    );
  });
});

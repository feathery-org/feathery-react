// Signs the release SBOM for the packed @feathery/react tarball before it is
// published:
//   node scripts/release-sbom/sign.cjs <dir with the .tgz> <out dir> [sign args]
// Extra arguments go to feathery_sbom.py sign (for example --pending-id).
//
// It describes what a consumer gets: the tarball installed the way npm 7+
// installs it for them, including the peer dependencies of our dependencies,
// but not our own peerDependencies (react, react-dom) or packages reachable
// only through them, because those resolve to the consumer's app. Plus every
// third-party package the build inlined into dist/, cjs/ and umd/ (recorded
// by bundled-packages.cjs), which includes the react the UMD bundle ships.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RECORD_DIR } = require('./bundled-packages.cjs');

const REPO = path.resolve(__dirname, '../..');
const PACKAGE = '@feathery/react';
const BUILDS = ['rollup', 'umd', 'pptx-worker'];
const NODE_MODULES = 'node_modules/';

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  // Set when the child never ran, for example ENOENT or a timeout.
  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args[0]} failed`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Node's lookup: the nearest node_modules/<name> at or above `from`.
function resolve(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = base
      ? `${base}/${NODE_MODULES}${name}`
      : `${NODE_MODULES}${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const parent = base.lastIndexOf(`/${NODE_MODULES}`);
    base = parent === -1 ? '' : base.slice(0, parent);
  }
}

// name@version -> install location of every package a consumer of `root`
// gets from us, read from npm's package-lock.json. Follows dependencies,
// optionalDependencies and peerDependencies (npm 7+ installs peers), except
// that root's own peerDependencies resolve to the consumer's app, so those
// packages, and anything reachable only through them, are left out.
function consumerPackages(lock, root) {
  const { packages } = lock;
  const rootLocation = `${NODE_MODULES}${root}`;
  if (!packages[rootLocation]) throw new Error(`${root} is not installed`);
  const consumers = new Set(
    Object.keys(packages[rootLocation].peerDependencies || {}).map((name) =>
      resolve(packages, rootLocation, name)
    )
  );
  const seen = new Set([rootLocation]);
  const queue = [rootLocation];
  while (queue.length) {
    const location = queue.shift();
    const entry = packages[location];
    const edges = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...(location === rootLocation ? {} : entry.peerDependencies)
    };
    for (const name of Object.keys(edges)) {
      const target = resolve(packages, location, name);
      if (target && !consumers.has(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  const result = new Map();
  for (const location of [...seen].sort()) {
    const entry = packages[location];
    const name =
      entry.name ||
      location.slice(location.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
    const id = `${name}@${entry.version}`;
    if (!result.has(id)) result.set(id, location);
  }
  return result;
}

// Where each package.json goes in the scanned directory: installed packages
// at their install location, inlined packages that are not also installed at
// the same version under bundled/. The tool counts only package roots
// (node_modules/<name>/package.json), so each inlined package gets one.
function scanLayout(installed, bundled) {
  const layout = [...installed].map(([, location]) => ({
    source: location,
    directory: location
  }));
  for (const [id, { name, manifest }] of bundled) {
    if (installed.has(id)) continue;
    layout.push({
      manifest,
      directory: path.posix.join('bundled', id, NODE_MODULES, name)
    });
  }
  return layout;
}

// name@version -> { name, manifest } of every third-party package the builds
// inlined. A record older than the version bump belongs to an earlier build.
function bundledPackages() {
  const bumped = fs.statSync(path.join(REPO, 'package.json')).mtimeMs;
  const bundled = new Map();
  for (const build of BUILDS) {
    const file = path.join(RECORD_DIR, `${build}.json`);
    if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < bumped) {
      throw new Error(`${file} is missing or older than package.json`);
    }
    for (const { name, version, manifest } of readJson(file).packages) {
      bundled.set(`${name}@${version}`, { name, manifest });
    }
  }
  return bundled;
}

function install(project, tarball) {
  fs.writeFileSync(path.join(project, 'package.json'), '{"private": true}\n');
  run(
    'npm',
    ['install', tarball, '--omit=dev', '--ignore-scripts', '--no-audit'],
    { cwd: project }
  );
  return readJson(path.join(project, 'package-lock.json'));
}

function main() {
  const [packageDir, out, ...signArgs] = process.argv.slice(2);
  if (!packageDir || !out) {
    throw new Error('usage: sign.cjs <package dir> <out dir> [sign args]');
  }
  const tarballs = fs.readdirSync(packageDir).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`expected one .tgz in ${packageDir}`);
  }
  const tarball = path.resolve(packageDir, tarballs[0]);
  const { version, peerDependencies } = readJson(
    path.join(REPO, 'package.json')
  );
  const peers = Object.keys(peerDependencies).join(' and ');

  const bundled = bundledPackages();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sbom-'));
  const scan = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sbom-scan-'));
  try {
    const installed = consumerPackages(install(project, tarball), PACKAGE);
    // npm skips optional packages built for other platforms.
    for (const [id, location] of installed) {
      if (!fs.existsSync(path.join(project, location, 'package.json'))) {
        installed.delete(id);
      }
    }
    for (const { source, manifest, directory } of scanLayout(
      installed,
      bundled
    )) {
      fs.mkdirSync(path.join(scan, directory), { recursive: true });
      fs.copyFileSync(
        manifest || path.join(project, source, 'package.json'),
        path.join(scan, directory, 'package.json')
      );
    }

    run('python3', [
      path.join(__dirname, 'feathery_sbom.py'),
      'sign',
      '--component',
      'feathery-react',
      '--source',
      `dir:${scan}`,
      '--profile',
      'node-installed',
      '--version',
      version,
      '--git-dir',
      REPO,
      '--first-party',
      '@feathery/',
      // The tarball is the version being released.
      '--require',
      `${PACKAGE}@${version.replace(/\./g, '\\.')}`,
      '--require',
      '@feathery/client-utils',
      // react ships only inlined in the UMD bundle; jszip is the dependency
      // rollup leaves external, so dist/ and cjs/ load the installed copy.
      '--require',
      'react',
      '--require',
      'jszip',
      '--min-packages',
      '211',
      '--artifact-file',
      tarball,
      '--describe',
      `npm tarball ${tarballs[0]} installed the way npm installs it for a ` +
        `consumer (${installed.size} packages, including peer dependencies ` +
        `of our dependencies; our own peerDependencies ${peers}, ` +
        `and packages reachable only through them, are left out because ` +
        `the consumer's app supplies them), plus the ${bundled.size} ` +
        `third-party packages the build inlined into dist, cjs and umd`,
      '--out',
      out,
      ...signArgs
    ]);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(scan, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[release-sbom] ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { consumerPackages, run, scanLayout };

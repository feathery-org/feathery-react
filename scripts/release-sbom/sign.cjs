// Signs the release SBOM for the packed @feathery/react tarball before it is
// published: node scripts/release-sbom/sign.cjs <dir with the .tgz> <out dir>
//
// It describes what a consumer gets: the tarball installed the way npm
// installs it for them (production dependencies, without peer dependencies,
// which the consumer's app supplies), plus every third-party package the
// build inlined into dist/, cjs/ and umd/ (recorded by bundled-packages.cjs).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RECORD_DIR } = require('./bundled-packages.cjs');

const REPO = path.resolve(__dirname, '../..');
const BUILDS = ['rollup', 'umd', 'pptx-worker'];

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args[0]} failed`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// name@version -> package.json of every third-party package the builds
// inlined. A record older than the version bump belongs to an earlier build.
function bundledPackages() {
  const bumped = fs.statSync(path.join(REPO, 'package.json')).mtimeMs;
  const bundled = new Map();
  for (const build of BUILDS) {
    const file = path.join(RECORD_DIR, `${build}.json`);
    if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < bumped) {
      throw new Error(`${file} is missing or older than package.json`);
    }
    for (const pkg of readJson(file).packages) {
      bundled.set(`${pkg.name}@${pkg.version}`, pkg.manifest);
    }
  }
  return bundled;
}

// name@version -> package.json of every package npm put on disk, once each
// (npm can install the same version at several nested paths).
function installedPackages(project, tarball) {
  fs.writeFileSync(path.join(project, 'package.json'), '{"private": true}\n');
  run(
    'npm',
    [
      'install',
      tarball,
      '--omit=dev',
      '--omit=peer',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund'
    ],
    { cwd: project }
  );
  const installed = new Map();
  const lock = readJson(path.join(project, 'package-lock.json'));
  for (const location of Object.keys(lock.packages)) {
    const manifest = path.join(project, location, 'package.json');
    if (!location || !fs.existsSync(manifest)) continue;
    const pkg = readJson(manifest);
    installed.set(`${pkg.name}@${pkg.version}`, { location, manifest });
  }
  return installed;
}

function main() {
  const [packageDir, out] = process.argv.slice(2);
  if (!packageDir || !out) {
    throw new Error('usage: sign.cjs <package dir> <out dir>');
  }
  const tarballs = fs.readdirSync(packageDir).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 1)
    throw new Error(`expected one .tgz in ${packageDir}`);
  const tarball = path.resolve(packageDir, tarballs[0]);
  const { version } = readJson(path.join(REPO, 'package.json'));

  const bundled = bundledPackages();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sbom-'));
  const scan = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sbom-scan-'));
  try {
    const installed = installedPackages(project, tarball);
    const copy = (manifest, directory) => {
      fs.mkdirSync(path.join(scan, directory), { recursive: true });
      fs.copyFileSync(manifest, path.join(scan, directory, 'package.json'));
    };
    for (const { location, manifest } of installed.values()) {
      copy(manifest, location);
    }
    // One entry per name@version: an inlined copy of a package that is also
    // installed at the same version adds nothing to the inventory. The tool
    // only counts package roots (node_modules/<name>/package.json), so each
    // inlined package gets one.
    for (const [id, manifest] of bundled) {
      if (installed.has(id)) continue;
      const { name } = readJson(manifest);
      copy(manifest, path.join('bundled', id, 'node_modules', name));
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
      `@feathery/react@${version.replace(/\./g, '\\.')}`,
      '--require',
      '@feathery/client-utils',
      // react ships only inlined in the UMD bundle; jszip is the dependency
      // rollup leaves external, so dist/ and cjs/ load the installed copy.
      '--require',
      'react',
      '--require',
      'jszip',
      '--min-packages',
      '195',
      '--artifact-file',
      tarball,
      '--describe',
      `npm tarball ${tarballs[0]} installed with its production ` +
        `dependencies (installed packages: ${installed.size}; peer ` +
        `dependencies omitted because the consumer supplies them), plus the ` +
        `${bundled.size} third-party packages the build inlined into dist, cjs and umd`,
      '--out',
      out
    ]);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(scan, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[release-sbom] ERROR: ${error.message}`);
  process.exit(1);
}

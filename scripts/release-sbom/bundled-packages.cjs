// Records which third-party packages each production build compiles into the
// files we publish. Rollup and webpack inline most of node_modules (and some
// devDependencies, such as react in the UMD build), so the installed dependency
// tree alone undercounts what ships. sign.cjs adds these packages to the
// release SBOM.
const fs = require('fs');
const path = require('path');

const RECORD_DIR = path.resolve(
  __dirname,
  '../../node_modules/.cache/release-sbom'
);
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

// node_modules/<name> or node_modules/@scope/<name>, innermost one wins.
function packageRoot(moduleId) {
  const file = moduleId.replace(/^\0/, '').split('?')[0];
  const index = file.lastIndexOf(NODE_MODULES);
  if (index === -1) return null;
  const parts = file.slice(index + NODE_MODULES.length).split(path.sep);
  const depth = parts[0].startsWith('@') ? 2 : 1;
  if (parts.length <= depth) return null;
  return (
    file.slice(0, index + NODE_MODULES.length) +
    parts.slice(0, depth).join(path.sep)
  );
}

function record(build, moduleIds, directory = RECORD_DIR) {
  const manifests = new Set();
  for (const id of moduleIds) {
    const root = packageRoot(id);
    if (root) manifests.add(path.join(root, 'package.json'));
  }
  const packages = [...manifests].sort().map((manifest) => {
    const { name, version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return { name, version, manifest };
  });
  fs.mkdirSync(directory, { recursive: true });
  // Both builds run in parallel and each bundles the pptx worker, so write
  // atomically.
  const target = path.join(directory, `${build}.json`);
  const temporary = `${target}.${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify({ build, packages }, null, 2));
  fs.renameSync(temporary, target);
}

function rollupPlugin(build) {
  const moduleIds = new Set();
  return {
    name: 'release-sbom-bundled-packages',
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          Object.keys(output.modules).forEach((id) => moduleIds.add(id));
        }
      }
    },
    closeBundle() {
      record(build, moduleIds);
    }
  };
}

class WebpackPlugin {
  constructor(build) {
    this.build = build;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tap(
      'ReleaseSbomBundledPackages',
      (compilation) => {
        const moduleIds = new Set();
        const add = (module) => {
          // Scope hoisting merges modules; record each one inside.
          if (module.modules) module.modules.forEach(add);
          if (module.resource) moduleIds.add(module.resource);
        };
        for (const chunk of compilation.chunks) {
          for (const module of compilation.chunkGraph.getChunkModulesIterable(
            chunk
          )) {
            add(module);
          }
        }
        record(this.build, moduleIds);
      }
    );
  }
}

module.exports = {
  RECORD_DIR,
  packageRoot,
  record,
  rollupPlugin,
  WebpackPlugin
};

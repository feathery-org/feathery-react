// Consumers bundle our output for the browser, and webpack 5 no longer
// polyfills Node built-ins, so one left in a chunk fails their build. This
// checks the code each module renders into a chunk, parsed rather than
// pattern-matched so comments and strings never count. commonjs leaves a
// require inside try/catch as written, so it never reaches `chunk.imports`.
const { parse } = require('acorn');
const { isBuiltin } = require('module');
const path = require('path');
const { packageRoot } = require('./release-sbom/bundled-packages.cjs');

function literal(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function moduleSource(node) {
  switch (node.type) {
    case 'CallExpression':
      return node.callee.type === 'Identifier' && node.callee.name === 'require'
        ? literal(node.arguments[0])
        : null;
    case 'ImportExpression':
    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
    case 'ExportNamedDeclaration':
      return literal(node.source);
    default:
      return null;
  }
}

function builtinReferences(code) {
  const found = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node.type !== 'string') return;
    const source = moduleSource(node);
    if (source && isBuiltin(source)) found.add(source);
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(
    parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true
    })
  );
  return found;
}

function owner(moduleId) {
  const root = packageRoot(moduleId);
  if (root) {
    const marker = `${path.sep}node_modules${path.sep}`;
    return root.slice(root.lastIndexOf(marker) + marker.length);
  }
  return path.relative(process.cwd(), moduleId.replace(/^\0/, ''));
}

function rollupPlugin() {
  return {
    name: 'no-node-builtins',
    generateBundle(_, bundle) {
      const leaks = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of [...chunk.imports, ...chunk.dynamicImports]) {
          if (isBuiltin(id)) leaks.push(`${chunk.fileName} imports ${id}`);
        }
        for (const [id, rendered] of Object.entries(chunk.modules)) {
          if (!rendered.code) continue;
          for (const source of builtinReferences(rendered.code)) {
            leaks.push(`${owner(id)} requires ${source} (${chunk.fileName})`);
          }
        }
      }
      if (leaks.length) {
        this.error(
          `Node built-ins in the browser bundle; resolve each package to its browser entry:\n${leaks.join(
            '\n'
          )}`
        );
      }
    }
  };
}

module.exports = { builtinReferences, rollupPlugin };

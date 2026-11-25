/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const { builtinReferences, rollupPlugin } = require('./no-node-builtins.cjs');

const found = (code) => [...builtinReferences(code)].sort();

describe('builtinReferences', () => {
  it('finds require, dynamic import and module declarations', () => {
    expect(found(`require('util')`)).toEqual(['util']);
    expect(found(`require( "events" )`)).toEqual(['events']);
    expect(found('require(`stream`)')).toEqual(['stream']);
    expect(found(`import('node:fs')`)).toEqual(['node:fs']);
    expect(found(`import util from 'util'`)).toEqual(['util']);
    expect(found(`export * from 'os'; export { x } from 'util/types'`)).toEqual(
      ['os', 'util/types']
    );
  });

  it('finds a require left inside try/catch', () => {
    expect(
      found(`try { var util = require('util'); } catch (e) { util = null; }`)
    ).toEqual(['util']);
  });

  it('ignores comments, strings and non-built-ins', () => {
    expect(
      found(`/**
       * @example
       *   import process from 'node:process'
       */
      // require('fs')
      const worker = "require('crypto')";
      const name = \`\${dir}/util\`;
      foo.require('path');
      require(\`\${name}\`);
      require('inherits');
      require('process/browser');`)
    ).toEqual([]);
  });

  it('flags the Node entry of inherits and not its browser entry', () => {
    const inherits = path.dirname(require.resolve('inherits/package.json'));
    const read = (file) => fs.readFileSync(path.join(inherits, file), 'utf8');
    expect(found(read('inherits.js'))).toEqual(['util']);
    expect(found(read('inherits_browser.js'))).toEqual([]);
  });
});

describe('rollupPlugin', () => {
  const generate = (bundle) => {
    const errors = [];
    rollupPlugin().generateBundle.call(
      { error: (message) => errors.push(message) },
      {},
      bundle
    );
    return errors;
  };
  const chunk = (modules, imports = []) => ({
    type: 'chunk',
    fileName: 'fthry_index.abc.js',
    imports,
    dynamicImports: [],
    modules
  });

  it('names the package and chunk for each leak', () => {
    const errors = generate({
      'fthry_index.abc.js': chunk(
        {
          [path.join('/r', 'node_modules', 'inherits', 'inherits.js')]: {
            code: `try { require('util') } catch (e) {}`
          },
          [path.join('/r', 'src', 'index.tsx')]: { code: `export const a = 1;` }
        },
        ['react', 'events']
      )
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('fthry_index.abc.js imports events');
    expect(errors[0]).toContain('inherits requires util (fthry_index.abc.js)');
  });

  it('passes a clean bundle and skips assets and tree-shaken modules', () => {
    expect(
      generate({
        'fthry_index.abc.js': chunk({ '/r/src/a.ts': { code: null } }, [
          'react'
        ]),
        'font.woff2': { type: 'asset' }
      })
    ).toEqual([]);
  });
});

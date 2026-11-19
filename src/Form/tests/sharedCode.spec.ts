import { compileSharedCode, linkSharedCode } from '../sharedCode';

const AsyncFunction = async function () {}.constructor as any;

// Runs rule code the way runClientSideLogic does, with `feathery` and one
// field global in the outer scope.
async function runRule(
  ruleCode: string,
  modules: Record<string, string>,
  globals: { feathery?: any; Color?: any } = {}
) {
  const compiled = compileSharedCode(
    Object.entries(modules).map(([key, code]) => ({ key, code } as any))
  );
  const { code, prelude } = linkSharedCode(ruleCode, compiled);
  const fn = new AsyncFunction(
    'feathery',
    'Color',
    `${prelude}\nreturn (async () => { ${code}\n })()`
  );
  return fn(globals.feathery ?? {}, globals.Color ?? {});
}

describe('shared code', () => {
  it('runs the documented example', async () => {
    const modules = {
      'Logic-1': `const favoriteColors = ['red', 'orange', 'green', 'blue'];
export function chooseColor(value) {
  const colorIndex = Number(value);
  if (!value || colorIndex < 0 || colorIndex > favoriteColors.length - 1) return '?';
  return favoriteColors[colorIndex];
}
export const randomColor = () => favoriteColors[0];`
    };
    await expect(
      runRule(
        `import { chooseColor, randomColor } from 'Logic-1';\nreturn [chooseColor('2'), randomColor()];`,
        modules
      )
    ).resolves.toEqual(['green', 'red']);
  });

  it('resolves helpers that use other module locals', async () => {
    const modules = {
      L: `const colors = ['red', 'blue'];
function pick(i) { return colors[i]; }
export function second() { return pick(1); }`
    };
    await expect(
      runRule(`import { second } from 'L';\nreturn second();`, modules)
    ).resolves.toBe('blue');
  });

  it('resolves locals derived from other locals and declared after use', async () => {
    const modules = {
      L: `export function count() { return n; }
const a = [1, 2, 3];
const n = a.length;`
    };
    await expect(
      runRule(`import { count } from 'L';\nreturn count();`, modules)
    ).resolves.toBe(3);
  });

  it('exports computed constants as values, not source text', async () => {
    const modules = {
      L: `const colors = ['red', 'blue'];
export const FIRST = colors[0];
export const N = 2 * 3;
export const CONFIG = { colors, size: colors.length };`
    };
    await expect(
      runRule(
        `import { FIRST, N, CONFIG } from 'L';\nreturn [FIRST, N, CONFIG];`,
        modules
      )
    ).resolves.toEqual(['red', 6, { colors: ['red', 'blue'], size: 2 }]);
  });

  it('supports aliased and namespace imports', async () => {
    const modules = {
      L: `export const A = 1;\nexport function b() { return 2; }`
    };
    await expect(
      runRule(
        `import { A as one } from 'L';\nimport * as lib from 'L';\nreturn [one, lib.b()];`,
        modules
      )
    ).resolves.toEqual([1, 2]);
  });

  it('lets shared code import other shared code', async () => {
    const modules = {
      Base: `export const TAX = 0.5;`,
      Money: `import { TAX } from 'Base';\nexport const withTax = (n) => n + n * TAX;`,
      Format: `import { withTax } from 'Money';\nexport const price = (n) => '$' + withTax(n);`
    };
    await expect(
      runRule(`import { price } from 'Format';\nreturn price(10);`, modules)
    ).resolves.toBe('$15');
  });

  it('runs a module once per rule run when imported twice', async () => {
    const feathery = { runs: 0 };
    const modules = {
      Counter: `feathery.runs += 1;\nexport const id = feathery.runs;`,
      A: `import { id } from 'Counter';\nexport const a = id;`,
      B: `import { id } from 'Counter';\nexport const b = id;`
    };
    await expect(
      runRule(
        `import { a } from 'A';\nimport { b } from 'B';\nreturn [a, b];`,
        modules,
        { feathery }
      )
    ).resolves.toEqual([1, 1]);
    expect(feathery.runs).toBe(1);
  });

  it('gives shared code the form globals but not the rule variables', async () => {
    const modules = {
      L: `export const color = () => Color.value;
export const local = () => typeof secret;`
    };
    await expect(
      runRule(
        `import { color, local } from 'L';\nconst secret = 1;\nreturn [color(), local()];`,
        modules,
        { Color: { value: 'red' } }
      )
    ).resolves.toEqual(['red', 'undefined']);
  });

  it('supports top-level await and return in the rule', async () => {
    const modules = {
      L: `export const load = async () => 'loaded';\nexport const ready = await Promise.resolve(true);`
    };
    await expect(
      runRule(
        `import { load, ready } from 'L';\nif (!ready) return 'no';\nreturn await load();`,
        modules
      )
    ).resolves.toBe('loaded');
  });

  it('keeps the rule code on its original lines', () => {
    const compiled = compileSharedCode([
      { key: 'L', code: 'export const A = 1;' } as any
    ]);
    const { code } = linkSharedCode(
      `import {\n  A\n} from 'L';\nfoo(A);`,
      compiled
    );
    expect(code.split('\n')[3]).toBe('foo(A);');
  });

  it('leaves rules without imports untouched', () => {
    expect(linkSharedCode('return 1;', {})).toEqual({
      code: 'return 1;',
      prelude: ''
    });
  });

  it('throws a clear error for circular imports', async () => {
    const modules = {
      A: `import { b } from 'B';\nexport const a = 1;`,
      B: `import { a } from 'A';\nexport const b = 2;`
    };
    await expect(
      runRule(`import { a } from 'A';\nreturn a;`, modules)
    ).rejects.toThrow('Circular shared code import: A -> B -> A');
  });

  it('throws a clear error for a missing module', async () => {
    await expect(
      runRule(`import { a } from 'Nope';\nreturn a;`, {})
    ).rejects.toThrow(`imports shared code "Nope", which doesn't exist`);
  });

  it('throws a clear error for a missing export, including nested ones', async () => {
    const modules = {
      A: `import { missing } from 'B';\nexport const a = 1;`,
      B: `export const b = 2;`
    };
    await expect(
      runRule(`import { nope } from 'B';\nreturn nope;`, modules)
    ).rejects.toThrow(`imports "nope" from shared code "B"`);
    await expect(
      runRule(`import { a } from 'A';\nreturn a;`, modules)
    ).rejects.toThrow(`Shared code "A" imports "missing" from shared code "B"`);
  });

  it('throws a clear error for shared code with a syntax error', async () => {
    await expect(
      runRule(`import { a } from 'Bad';\nreturn a;`, {
        Bad: 'export const a = ;'
      })
    ).rejects.toThrow('Shared code "Bad" has a syntax error');
  });

  it('runs shared code whose stored valid flag is false', async () => {
    const compiled = compileSharedCode([
      {
        key: 'L',
        code: "export function greet() { return 'hi'; }",
        valid: false
      } as any
    ]);
    expect(compiled.L.exports).toEqual(['greet']);
  });
});

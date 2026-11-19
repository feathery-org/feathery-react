// Shared code modules for client-side logic rules.
//
// Each module runs as a whole, like an ES module: its top-level statements run
// once per rule run, in order, and it returns its exports. Rules and modules
// import from modules by key, so modules can import other modules. Modules run
// in the rule's outer scope, so they see `feathery` and the field globals but
// not the rule's own variables.
import { parse as acornParse, Options, Program } from 'acorn';
import { parse as acornLooseParse } from 'acorn-loose';
import { SharedCodeInfo } from './definitions';

export interface SharedCodeImport {
  key: string;
  /** Exported names it imports */
  names: string[];
}

export interface SharedCodeModule {
  key: string;
  /** Function body that runs the module and returns its exports */
  body: string;
  /** What it imports, from which module keys */
  imports: SharedCodeImport[];
  exports: string[];
  /** Set when the module can't be parsed; importing it throws this */
  error?: string;
}

export type SharedCodeModules = Record<string, SharedCodeModule>;

export interface LinkedRuleCode {
  /** Rule code with its imports replaced by bindings */
  code: string;
  /** Declares the imported modules; runs before the rule, outside its scope */
  prelude: string;
}

const IMPORT_FN = '__featheryImport';
const MODULES_VAR = '__featheryModules';
const CACHE_VAR = '__featheryModuleCache';

interface ImportBinding extends SharedCodeImport {
  statement: string;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

const PARSE_OPTIONS: Options = {
  ecmaVersion: 'latest',
  sourceType: 'module'
};

function applyEdits(code: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end),
      code
    );
}

// Keeps line breaks so the rest of the code stays on its original lines
const blankOut = (code: string, node: any): TextEdit => ({
  start: node.start,
  end: node.end,
  text: code.slice(node.start, node.end).replace(/[^\n]/g, '')
});

const specifierName = (node: any): string => node.name ?? String(node.value);

function importBinding(node: any): ImportBinding {
  const key = String(node.source.value);
  const source = `await ${IMPORT_FN}(${JSON.stringify(key)})`;
  const names: string[] = [];
  const properties: string[] = [];
  const statements: string[] = [];

  for (const specifier of node.specifiers) {
    const local = specifier.local.name;
    if (specifier.type === 'ImportNamespaceSpecifier') {
      statements.push(`const ${local} = ${source};`);
      continue;
    }
    // Default imports have always resolved the export of the same name
    const imported =
      specifier.type === 'ImportSpecifier'
        ? specifierName(specifier.imported)
        : local;
    names.push(imported);
    properties.push(`${JSON.stringify(imported)}: ${local}`);
  }

  if (properties.length || !statements.length) {
    statements.unshift(`const { ${properties.join(', ')} } = ${source};`);
  }
  return { key, names, statement: statements.join(' ') };
}

function patternNames(pattern: any): string[] {
  switch (pattern?.type) {
    case 'Identifier':
      return [pattern.name];
    case 'ObjectPattern':
      return pattern.properties.flatMap((p: any) =>
        patternNames(p.type === 'RestElement' ? p.argument : p.value)
      );
    case 'ArrayPattern':
      return pattern.elements.flatMap((el: any) => patternNames(el));
    case 'RestElement':
      return patternNames(pattern.argument);
    case 'AssignmentPattern':
      return patternNames(pattern.left);
    default:
      return [];
  }
}

function declarationNames(declaration: any): string[] {
  if (declaration.type === 'VariableDeclaration') {
    return declaration.declarations.flatMap((d: any) => patternNames(d.id));
  }
  return declaration.id ? [declaration.id.name] : [];
}

function compileModule({ key, code }: SharedCodeInfo): SharedCodeModule {
  let program: Program;
  try {
    program = acornParse(code ?? '', {
      ...PARSE_OPTIONS,
      allowAwaitOutsideFunction: true
    });
  } catch (e: any) {
    return {
      key,
      body: '',
      imports: [],
      exports: [],
      error: `Shared code "${key}" has a syntax error: ${e?.message}`
    };
  }

  const bindings: ImportBinding[] = [];
  const exports: string[] = [];
  const edits: TextEdit[] = [];

  for (const node of program.body as any[]) {
    if (node.type === 'ImportDeclaration') {
      bindings.push(importBinding(node));
      edits.push(blankOut(code, node));
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      // `export const a = 1` -> `const a = 1`
      edits.push({ start: node.start, end: node.declaration.start, text: '' });
      exports.push(...declarationNames(node.declaration));
    }
  }

  const body = [
    ...bindings.map((b) => b.statement),
    applyEdits(code, edits),
    `return { ${exports.join(', ')} };`
  ].join('\n');

  return {
    key,
    body,
    imports: bindings.map(({ key, names }) => ({ key, names })),
    exports
  };
}

/** Compiles a form's shared code once, for every rule run to link against. */
export function compileSharedCode(
  sharedCodes: SharedCodeInfo[]
): SharedCodeModules {
  return Object.fromEntries(
    sharedCodes.map((sharedCode) => [sharedCode.key, compileModule(sharedCode)])
  );
}

// Rule code runs inside an async function, so top-level return and await are valid
function parseRule(code: string): Program | null {
  try {
    return acornParse(code, {
      ...PARSE_OPTIONS,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
  } catch {
    // Let the rule's own syntax error surface when it runs
    try {
      return acornLooseParse(code, { ecmaVersion: 'latest' }) as Program;
    } catch {
      return null;
    }
  }
}

function getModule(
  modules: SharedCodeModules,
  key: string,
  importer: string
): SharedCodeModule {
  const module = modules[key];
  if (!module) {
    throw new Error(
      `${importer} imports shared code "${key}", which doesn't exist`
    );
  }
  if (module.error) throw new Error(module.error);
  return module;
}

function checkNames(
  module: SharedCodeModule,
  binding: SharedCodeImport,
  importer: string
) {
  const missing = binding.names.find((name) => !module.exports.includes(name));
  if (missing) {
    throw new Error(
      `${importer} imports "${missing}" from shared code "${module.key}", which doesn't export it`
    );
  }
}

// The modules a rule needs, dependencies first. Throws on missing modules,
// missing exports and circular imports.
function collectModules(
  bindings: ImportBinding[],
  modules: SharedCodeModules
): SharedCodeModule[] {
  const ordered: SharedCodeModule[] = [];
  const done = new Set<string>();

  const visit = (key: string, importer: string, path: string[]) => {
    if (path.includes(key)) {
      throw new Error(
        `Circular shared code import: ${[...path, key].join(' -> ')}`
      );
    }
    const module = getModule(modules, key, importer);
    if (done.has(key)) return;

    const moduleImporter = `Shared code "${key}"`;
    for (const dependency of module.imports) {
      visit(dependency.key, moduleImporter, [...path, key]);
      checkNames(modules[dependency.key], dependency, moduleImporter);
    }
    done.add(key);
    ordered.push(module);
  };

  for (const binding of bindings) {
    visit(binding.key, 'This rule', []);
    checkNames(modules[binding.key], binding, 'This rule');
  }
  return ordered;
}

/**
 * Replaces a rule's shared code imports with bindings to the modules, which
 * the returned prelude declares. Each imported module runs at most once per
 * rule run.
 */
export function linkSharedCode(
  ruleCode: string,
  modules: SharedCodeModules
): LinkedRuleCode {
  const unlinked = { code: ruleCode, prelude: '' };
  if (!ruleCode || !/\bimport\b/.test(ruleCode)) return unlinked;

  const program = parseRule(ruleCode);
  if (!program) return unlinked;

  const imports = (program.body as any[]).filter(
    (node) => node.type === 'ImportDeclaration'
  );
  if (!imports.length) return unlinked;

  const bindings = imports.map(importBinding);
  const used = collectModules(bindings, modules);

  const factories = used.map(
    (module) =>
      `${JSON.stringify(module.key)}: async () => {\n${module.body}\n}`
  );
  const prelude = [
    `const ${CACHE_VAR} = {};`,
    `const ${MODULES_VAR} = {\n${factories.join(',\n')}\n};`,
    `function ${IMPORT_FN}(key) {`,
    `  if (!${CACHE_VAR}[key]) ${CACHE_VAR}[key] = ${MODULES_VAR}[key]();`,
    `  return ${CACHE_VAR}[key];`,
    `}`
  ].join('\n');

  // Bindings go on the first line so the rule's lines keep their numbers
  const code =
    bindings.map((b) => b.statement).join(' ') +
    ' ' +
    applyEdits(
      ruleCode,
      imports.map((node) => blankOut(ruleCode, node))
    );

  return { code, prelude };
}

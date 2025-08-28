import { parse as acornParse, Program } from 'acorn';
import * as walk from 'acorn-walk';
import {
  ExtractedExportFuncInfo,
  ExtractedExportVarInfo,
  ExtractedReusableLogicInfo,
  ReusableLogicInfo
} from '../Form/definitions';

export function getAcornParsedNodes(input: string): Program | null {
  let parsedNode: Program | null = null;

  try {
    parsedNode = acornParse(input, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true
    });
  } catch {}

  return parsedNode;
}

function extractReferencedIdentifiers(bodyNode: any): Set<string> {
  const identifiers = new Set<string>();

  walk.simple(bodyNode, {
    Identifier(node: any) {
      identifiers.add(node.name);
    }
  });

  return identifiers;
}

function isValidIdentifierName(key: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(key);
}

// Convert a limited subset of AST nodes into plain JS values.
// Handles Literal, ArrayExpression, ObjectExpression, and simple UnaryExpression.
function astToJsValue(node: any): { ok: true; value: any } | { ok: false } {
  switch (node.type) {
    case 'Literal':
      return { ok: true, value: node.value };
    case 'ArrayExpression': {
      const out: any[] = [];

      for (const el of node.elements) {
        if (!el) return { ok: false }; // holes not supported

        const r = astToJsValue(el);

        if (!r.ok) return { ok: false };

        out.push(r.value);
      }

      return { ok: true, value: out };
    }
    case 'ObjectExpression': {
      const obj: Record<string, any> = {};

      for (const prop of node.properties) {
        // Support standard properties only
        if (prop.type !== 'Property' || prop.computed) return { ok: false };

        // Key may be Identifier or Literal(string/number)
        let key: string;

        if (prop.key.type === 'Identifier') key = prop.key.name;
        else if (prop.key.type === 'Literal') key = String(prop.key.value);
        else return { ok: false };

        const r = astToJsValue(prop.value);

        if (!r.ok) return { ok: false };

        obj[key] = r.value;
      }

      return { ok: true, value: obj };
    }
    case 'UnaryExpression': {
      // Support numeric negation like -1
      if (node.operator === '-' || node.operator === '+') {
        const r = astToJsValue(node.argument);

        if (!r.ok || typeof r.value !== 'number') return { ok: false };

        return {
          ok: true,
          value: node.operator === '-' ? -r.value : +r.value
        };
      }

      if (node.operator === '!') {
        const r = astToJsValue(node.argument);

        if (!r.ok) return { ok: false };

        return { ok: true, value: !r.value };
      }
      return { ok: false };
    }
    case 'TemplateLiteral': {
      // Only handle no-expr templates like `hello`
      if (node.expressions?.length) return { ok: false };

      const raw = node.quasis.map((q: any) => q.value.cooked ?? '').join('');

      return { ok: true, value: raw };
    }
    default:
      return { ok: false };
  }
}

// Serialize a JS value back to JS code (not JSON).
// Uses single quotes for strings and preserves identifier keys unquoted.
function printJsValue(v: any): string {
  if (v === null) return 'null';

  const t = typeof v;

  if (t === 'number' || t === 'boolean') return String(v);

  if (t === 'string') {
    // escape single quotes and backslashes
    const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return `'${escaped}'`;
  }

  if (Array.isArray(v)) {
    return `[${v.map((x) => printJsValue(x)).join(', ')}]`;
  }

  if (t === 'object') {
    const entries = Object.keys(v).map((k) => {
      const keyCode = isValidIdentifierName(k) ? k : printJsValue(k);
      return `${keyCode}: ${printJsValue(v[k])}`;
    });

    return `{ ${entries.join(', ')} }`;
  }

  // Fallback for unsupported types
  return String(v);
}

function extractJsElements(code: string): {
  exportVariables: ExtractedExportVarInfo[];
  exportFunctions: ExtractedExportFuncInfo[];
} {
  const variableMap = new Map<string, { declaration: string; value: string }>();
  const functionMap = new Map<string, { signature: string; body: string }>();
  const exportFunctions: ExtractedExportFuncInfo[] = [];
  const exportVariables: ExtractedExportVarInfo[] = [];

  const parsedNodes = getAcornParsedNodes(code);
  if (!parsedNodes) return { exportVariables, exportFunctions };

  // Helper: turn a param node into its original text
  const paramText = (p: any) => code.slice(p.start, p.end);

  // Helper: build function signature and body from FunctionExpression or ArrowFunctionExpression
  const buildFnParts = (fnNode: any) => {
    const params = (fnNode.params ?? []).map((p: any) => paramText(p));
    let body: string;

    // If body is a block, take inside braces; if it's an expression, wrap in a return statement
    if (fnNode.body?.type === 'BlockStatement') {
      const bodyStart = fnNode.body.start + 1;
      const bodyEnd = fnNode.body.end - 1;
      body = code.slice(bodyStart, bodyEnd).trim();
    } else {
      // Expression-bodied arrow function
      const expr = code.slice(fnNode.body.start, fnNode.body.end).trim();
      body = `return ${expr};`;
    }

    return { signature: `(${params.join(', ')})`, body };
  };

  for (const node of parsedNodes.body) {
    // 1) Collect non-export variable declarations (and lift function expressions)
    if (node.type === 'VariableDeclaration') {
      const kind = node.kind; // const | let | var

      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier') continue;

        const name = decl.id.name;
        const valueCode = code.slice(decl.start, decl.end);

        // Keep full declaration text for potential dependency prelude
        variableMap.set(name, {
          declaration: `${kind} ${valueCode};`,
          value: valueCode
        });

        // Lift function expressions and arrow functions (including expression-bodied)
        if (
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' ||
            decl.init.type === 'FunctionExpression')
        ) {
          const { signature, body } = buildFnParts(decl.init);
          functionMap.set(name, { signature, body });
        }
      }
    }

    // 2) Collect non-export function declarations
    if (node.type === 'FunctionDeclaration' && node.id) {
      const name = node.id.name;
      const params = node.params.map((p: any) => paramText(p));
      const bodyStart = node.body.start + 1;
      const bodyEnd = node.body.end - 1;
      const body = code.slice(bodyStart, bodyEnd).trim();

      functionMap.set(name, {
        signature: `(${params.join(', ')})`,
        body
      });
    }

    // 3) Exported function declarations
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration'
    ) {
      const funcNode = node.declaration;
      const name = funcNode.id.name;
      const params = funcNode.params.map((p: any) => paramText(p));
      const bodyStart = funcNode.body.start + 1;
      const bodyEnd = funcNode.body.end - 1;
      const body = code.slice(bodyStart, bodyEnd).trim();

      // Register exported function first
      functionMap.set(name, {
        signature: `(${params.join(', ')})`,
        body
      });

      // Build minimal dependency prelude
      const used = extractReferencedIdentifiers(funcNode.body);
      const prelude: string[] = [];
      const seen = new Set<string>();

      for (const id of used) {
        if (id === name || seen.has(id)) continue;

        const fn = functionMap.get(id);
        if (fn) {
          prelude.push(`function ${id}${fn.signature} {\n${fn.body}\n}`);
          seen.add(id);
          continue;
        }

        const v = variableMap.get(id);
        if (v) {
          prelude.push(v.declaration);
          seen.add(id);
        }
      }

      exportFunctions.push({
        name,
        signature: `(${params.join(', ')})`,
        body: prelude.concat([body]).join('\n')
      });
    }

    // 4) Exported variable declarations
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration'
    ) {
      const kind = node.declaration.kind;

      for (const decl of node.declaration.declarations) {
        if (decl.id.type !== 'Identifier') continue;

        const name = decl.id.name;
        const valueCode = code.slice(decl.start, decl.end);

        // Keep full declaration for possible prelude usage
        variableMap.set(name, {
          declaration: `${kind} ${valueCode};`,
          value: valueCode
        });

        // If export is a function expression or arrow function, treat it as an exported function
        if (
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' ||
            decl.init.type === 'FunctionExpression')
        ) {
          const { signature, body } = buildFnParts(decl.init);

          // Register in functionMap so other exports can depend on it
          functionMap.set(name, { signature, body });

          const used = extractReferencedIdentifiers(decl.init.body);
          const prelude: string[] = [];
          const seen = new Set<string>();

          for (const id of used) {
            if (id === name || seen.has(id)) continue;

            const fn = functionMap.get(id);
            if (fn) {
              prelude.push(`function ${id}${fn.signature} {\n${fn.body}\n}`);
              seen.add(id);
              continue;
            }

            const v = variableMap.get(id);
            if (v) {
              prelude.push(v.declaration);
              seen.add(id);
            }
          }

          exportFunctions.push({
            name,
            signature,
            body: prelude.concat([body]).join('\n')
          });
          continue;
        }

        // Otherwise handle exported variables as before
        if (decl.init) {
          if (decl.init.type === 'Literal') {
            exportVariables.push({
              name,
              value: (decl.init as any).value
            });
          } else if (
            decl.init.type === 'ArrayExpression' ||
            decl.init.type === 'ObjectExpression' ||
            decl.init.type === 'UnaryExpression' ||
            decl.init.type === 'TemplateLiteral'
          ) {
            const r = astToJsValue(decl.init);
            if (r.ok) {
              exportVariables.push({ name, value: r.value });
            } else {
              const initCode = code.slice(decl.init.start, decl.init.end);
              exportVariables.push({ name, value: initCode });
            }
          } else {
            const initCode = code.slice(decl.init.start, decl.init.end);
            exportVariables.push({ name, value: initCode });
          }
        } else {
          exportVariables.push({ name, value: 'undefined' });
        }
      }
    }
  }

  return { exportVariables, exportFunctions };
}

export function extractExportedCodeInfoArray(
  reusableLogicInfoArray: ReusableLogicInfo[]
): ExtractedReusableLogicInfo[] {
  return reusableLogicInfoArray
    .filter((codeInfo) => codeInfo.valid)
    .map((codeInfo) => ({
      key: codeInfo.key,
      ...extractJsElements(codeInfo.code)
    }));
}

export function replaceImportsWithDefinitions(
  code: string,
  extractedReusableLogicInfo: ExtractedReusableLogicInfo[]
): string {
  const lines = code.split('\n');
  const definitions: string[] = [];
  const importLinesToRemove = new Set<number>();

  const parsedNodes = getAcornParsedNodes(code);

  if (!parsedNodes) {
    return code;
  }

  walk.simple(parsedNodes, {
    ImportDeclaration(node: any) {
      const key = node.source.value;
      const rule = extractedReusableLogicInfo.find((r: any) => r.key === key);
      if (!rule) return;

      const start = node.loc.start.line - 1;
      const end = node.loc.end.line - 1;

      for (let i = start; i <= end; i++) {
        importLinesToRemove.add(i);
      }

      for (const specifier of node.specifiers) {
        let importedName: string;
        let localName: string;

        if (specifier.type === 'ImportSpecifier') {
          importedName = specifier.imported.name;
          localName = specifier.local.name;
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          importedName = specifier.local.name;
          localName = specifier.local.name;
        } else {
          continue;
        }

        const matchedVar = rule.exportVariables.find(
          (v: any) => v.name === importedName
        );
        if (matchedVar) {
          // If value is a plain JS value (string/number/boolean/null/array/object),
          // print JS code accordingly. For plain strings we output single-quoted literals.
          const rhs = printJsValue(matchedVar.value);
          definitions.push(`const ${localName} = ${rhs};`);

          continue;
        }

        const matchedFunc = rule.exportFunctions.find(
          (f: any) => f.name === importedName
        );
        if (matchedFunc) {
          definitions.push(
            `function ${localName}${matchedFunc.signature} {\n${matchedFunc.body}\n}`
          );
        }
      }
    }
  });

  const remainingLines = lines.filter(
    (_, idx) => !importLinesToRemove.has(idx)
  );

  return [...definitions, '', ...remainingLines].join('\n');
}

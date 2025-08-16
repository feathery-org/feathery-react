import { parse as acornParse, Program } from 'acorn';
import * as walk from 'acorn-walk';
import {
  ExtractedExportFuncInfo,
  ExtractedExportVarInfo,
  ExtractedReusableLogicInfo,
  ReusableLogicInfo
} from './definitions';

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

export function extractJsElements(code: string): {
  exportVariables: ExtractedExportVarInfo[];
  exportFunctions: ExtractedExportFuncInfo[];
} {
  const variableMap = new Map<string, { declaration: string; value: string }>();
  const functionMap = new Map<string, { signature: string; body: string }>();
  const exportFunctions: ExtractedExportFuncInfo[] = [];
  const exportVariables: ExtractedExportVarInfo[] = [];

  const parsedNodes = getAcornParsedNodes(code);

  if (!parsedNodes) {
    return { exportVariables, exportFunctions };
  }

  for (const node of parsedNodes.body) {
    // define variables
    if (node.type === 'VariableDeclaration') {
      const kind = node.kind; // const, let, var

      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier') {
          continue;
        }

        const name = decl.id.name;
        const valueCode = code.slice(decl.start, decl.end);

        variableMap.set(name, {
          declaration: `${kind} ${valueCode};`,
          value: valueCode
        });

        if (
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' ||
            decl.init.type === 'FunctionExpression')
        ) {
          const params = decl.init.params.map((p: any) => p.name || 'unknown');
          const bodyStart = decl.init.body.start + 1;
          const bodyEnd = decl.init.body.end - 1;
          const body = code.slice(bodyStart, bodyEnd).trim();

          functionMap.set(name, {
            signature: `(${params.join(', ')})`,
            body
          });
        }
      }
    }

    // define functions
    if (node.type === 'FunctionDeclaration' && node.id) {
      const name = node.id.name;
      const params = node.params.map((p: any) => p.name || 'unknown');
      const bodyStart = node.body.start + 1;
      const bodyEnd = node.body.end - 1;
      const body = code.slice(bodyStart, bodyEnd).trim();

      functionMap.set(name, {
        signature: `(${params.join(', ')})`,
        body
      });
    }

    // extract functions
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration'
    ) {
      const funcNode = node.declaration;
      const name = funcNode.id.name;
      const params = funcNode.params.map((p: any) => p.name || 'unknown');
      const bodyStart = funcNode.body.start + 1;
      const bodyEnd = funcNode.body.end - 1;
      const body = code.slice(bodyStart, bodyEnd).trim();

      const used = extractReferencedIdentifiers(funcNode.body);
      const prelude: string[] = [];

      for (const id of used) {
        if (variableMap.has(id)) {
          const variable = variableMap.get(id);

          if (variable !== undefined) {
            const { declaration } = variable;
            prelude.push(declaration);
          }
        } else if (functionMap.has(id)) {
          const fn = functionMap.get(id);

          if (fn !== undefined) {
            prelude.push(`function ${id}${fn.signature} {\n${fn.body}\n}`);
          }
        }
      }

      exportFunctions.push({
        name,
        signature: `(${params.join(', ')})`,
        body: prelude.concat([body]).join('\n')
      });
    }

    // extract constant variables
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration'
    ) {
      const kind = node.declaration.kind;

      for (const decl of node.declaration.declarations) {
        if (decl.id.type !== 'Identifier') {
          continue;
        }

        const name = decl.id.name;
        const valueCode = code.slice(decl.start, decl.end);
        variableMap.set(name, {
          declaration: `${kind} ${valueCode};`,
          value: valueCode
        });

        if (
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' ||
            decl.init.type === 'FunctionExpression')
        ) {
          const params = decl.init.params.map((p: any) => p.name || 'unknown');
          const bodyStart = decl.init.body.start + 1;
          const bodyEnd = decl.init.body.end - 1;
          const body = code.slice(bodyStart, bodyEnd).trim();

          const used = extractReferencedIdentifiers(decl.init.body);
          const prelude: string[] = [];

          for (const id of used) {
            if (variableMap.has(id)) {
              const variable = variableMap.get(id);

              if (variable !== undefined) {
                const { declaration } = variable;
                prelude.push(declaration);
              }
            } else if (functionMap.has(id)) {
              const fn = functionMap.get(id);

              if (fn !== undefined) {
                prelude.push(`function ${id}${fn.signature} {\n${fn.body}\n}`);
              }
            }
          }

          // extract arrow functions
          exportFunctions.push({
            name,
            signature: `(${params.join(', ')})`,
            body: prelude.concat([body]).join('\n')
          });
        } else {
          // extract constant variables, ensure value is handled correctly
          if (decl.init && decl.init.type === 'Literal') {
            if (typeof decl.init.value === 'string') {
              // For string literals, use the exact quote type as in the code
              exportVariables.push({
                name,
                value: `${decl.init.raw}` // Directly use the raw value (keeping quotes intact)
              });
            } else {
              // For numbers, no quotes
              exportVariables.push({
                name,
                value: `${decl.init.value}` // No quotes for numbers
              });
            }
          } else {
            exportVariables.push({
              name,
              value: `(${valueCode})` // Keep the original code if it's not a literal
            });
          }
        }
      }
    }
  }

  return {
    exportVariables,
    exportFunctions
  };
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
          definitions.push(`const ${localName} = ${matchedVar.value};`);
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

import { parse as acornParse, Program } from 'acorn';
import { parse as acornLooseParse } from 'acorn-loose';
import * as walk from 'acorn-walk';
import {
  ExtractedExportFuncInfo,
  ExtractedExportVarInfo,
  ExtractedSharedCodeInfo,
  SharedCodeDeclaration,
  SharedCodeInfo
} from './definitions';
import {
  httpHelpers,
  processFileValues,
  rerenderAllForms
} from '../utils/formHelperFunctions';
import { isValidFieldIdentifier } from '../utils/fieldHelperFunctions';
import { setFieldValues } from '../utils/init';
import {
  ClientSideLogicRule,
  LogicRule,
  ServerSideLogicRule
} from '../types/Form';
import Field from '../utils/entities/Field';
import internalStateStore, { FormInternalState } from '../utils/internalState';
import { getFormContext } from '../utils/formContext';
import { getPrivateActions } from '../utils/sensitiveActions';
import { sanitizeTransportValue } from '../utils/transportValue';
import {
  ChangedFieldDetail,
  composeFieldChanges,
  FieldChange,
  LogicRuleTransportResult,
  withoutEmbeddedFieldUpdates
} from '../utils/logicRuleResult';

function getAcornParsedNodes(input: string): Program | null {
  let parsedNode: Program | null = null;

  try {
    parsedNode = acornParse(input, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true
    });
  } catch {
    // attempt parse with more error-tolerant parser.
    // handles rules with both shared code and top-level
    // return, which is technically invalid syntax
    try {
      parsedNode = acornLooseParse(input, {
        ecmaVersion: 'latest',
        locations: true
      });
    } catch {}
  }
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

  // Handle RegExp literals: print as `/pattern/flags`
  if (v instanceof RegExp) {
    return v.toString(); // e.g., `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
  }

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

// Whether evaluating this node awaits at the module's top level. An await
// inside a nested function runs only when that function is called.
function awaitsAtTopLevel(node: any): boolean {
  let awaits = false;
  const skipNestedFunction = () => {};

  walk.recursive(node, null, {
    AwaitExpression() {
      awaits = true;
    },
    ForOfStatement(forOf: any, state: any, visit: any) {
      if (forOf.await) awaits = true;
      visit(forOf.left, state);
      visit(forOf.right, state);
      visit(forOf.body, state);
    },
    FunctionDeclaration: skipNestedFunction,
    FunctionExpression: skipNestedFunction,
    ArrowFunctionExpression: skipNestedFunction
  });

  return awaits;
}

function addPatternNames(pattern: any, names: Set<string>) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') names.add(pattern.name);
  if (pattern.type === 'AssignmentPattern')
    addPatternNames(pattern.left, names);
  if (pattern.type === 'RestElement') addPatternNames(pattern.argument, names);
  if (pattern.type === 'ArrayPattern') {
    pattern.elements.forEach((element: any) => addPatternNames(element, names));
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      addPatternNames(
        property.type === 'RestElement' ? property.argument : property.value,
        names
      );
    }
  }
}

// Names a function declares itself: its parameters and its body's top-level
// declarations, which a prelude must not declare again
function namesBoundBy(fnNode: any): Set<string> {
  const names = new Set<string>();
  fnNode.params.forEach((param: any) => addPatternNames(param, names));
  if (fnNode.body.type !== 'BlockStatement') return names;

  for (const statement of fnNode.body.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations) {
        addPatternNames(declarator.id, names);
      }
    }
    if (
      (statement.type === 'FunctionDeclaration' ||
        statement.type === 'ClassDeclaration') &&
      statement.id
    ) {
      names.add(statement.id.name);
    }
  }
  return names;
}

// Names this node reads while it is evaluated. A nested function's body runs
// only when that function is called.
function evaluatedIdentifiers(node: any): Set<string> {
  const identifiers = new Set<string>();
  const skipNestedFunction = () => {};

  walk.recursive(node, null, {
    Identifier(identifier: any) {
      identifiers.add(identifier.name);
    },
    FunctionDeclaration: skipNestedFunction,
    FunctionExpression: skipNestedFunction,
    ArrowFunctionExpression: skipNestedFunction
  });

  return identifiers;
}

function extractJsElements(code: string): Omit<ExtractedSharedCodeInfo, 'key'> {
  const declarations: SharedCodeDeclaration[] = [];
  const exportFunctions: ExtractedExportFuncInfo[] = [];
  const exportVariables: ExtractedExportVarInfo[] = [];

  const parsedNodes = getAcornParsedNodes(code);
  if (!parsedNodes) {
    console.warn('Failed to parse logic rule code');
    return { declarations, exportVariables, exportFunctions };
  }

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

    return {
      signature: `(${params.join(', ')})`,
      body,
      isAsync: fnNode?.async
    };
  };

  const isFunctionNode = (node: any) =>
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression';

  const exportedFunction = (name: string, fnNode: any) => {
    const ownNames = namesBoundBy(fnNode);
    exportFunctions.push({
      name,
      ...buildFnParts(fnNode),
      referencedNames: [...extractReferencedIdentifiers(fnNode.body)].filter(
        (referencedName) => !ownNames.has(referencedName)
      ),
      ownNames: [...ownNames]
    });
  };

  // Every top-level declaration, exported or not, in source order, so a helper
  // can depend on one declared anywhere in the module
  for (const node of parsedNodes.body as any[]) {
    const isExport = node.type === 'ExportNamedDeclaration';
    const declarationNode = isExport ? node.declaration : node;

    if (declarationNode?.type === 'VariableDeclaration') {
      const kind = declarationNode.kind; // const | let | var

      for (const decl of declarationNode.declarations) {
        if (decl.id.type !== 'Identifier') continue;

        const name = decl.id.name;
        const declaration = `${kind} ${code.slice(decl.start, decl.end)};`;

        if (isFunctionNode(decl.init)) {
          const { signature, body, isAsync } = buildFnParts(decl.init);
          declarations.push({
            name,
            code: `${
              isAsync ? 'async ' : ''
            }function ${name}${signature} {\n${body}\n}`,
            isFunction: true,
            referencedNames: [...extractReferencedIdentifiers(decl.init.body)],
            evaluatedNames: [],
            awaits: false
          });
          if (isExport) exportedFunction(name, decl.init);
          continue;
        }

        declarations.push({
          name,
          code: declaration,
          isFunction: false,
          referencedNames: decl.init
            ? [...extractReferencedIdentifiers(decl.init)]
            : [],
          evaluatedNames: decl.init ? [...evaluatedIdentifiers(decl.init)] : [],
          awaits: Boolean(decl.init) && awaitsAtTopLevel(decl.init)
        });
        if (!isExport) continue;

        if (!decl.init) {
          exportVariables.push({ name, value: 'undefined' });
          continue;
        }

        const staticValue = astToJsValue(decl.init);
        if (staticValue.ok) {
          exportVariables.push({ name, value: staticValue.value });
          continue;
        }

        exportVariables.push({
          name,
          value: code.slice(decl.init.start, decl.init.end),
          isComputed: true
        });
      }
    }

    if (declarationNode?.type === 'FunctionDeclaration' && declarationNode.id) {
      const name = declarationNode.id.name;
      const params = declarationNode.params.map((p: any) => paramText(p));
      const body = code
        .slice(declarationNode.body.start + 1, declarationNode.body.end - 1)
        .trim();

      declarations.push({
        name,
        code: `${
          declarationNode.async ? 'async ' : ''
        }function ${name}(${params.join(', ')}) {\n${body}\n}`,
        isFunction: true,
        referencedNames: [
          ...extractReferencedIdentifiers(declarationNode.body)
        ],
        evaluatedNames: [],
        awaits: false
      });
      if (isExport) exportedFunction(name, declarationNode);
    }
  }

  return { declarations, exportVariables, exportFunctions };
}

export function extractExportedCodeInfoArray(
  sharedCodeInfoArray: SharedCodeInfo[]
): ExtractedSharedCodeInfo[] {
  // valid is a builder lint result, not a runtime gate (rules run regardless).
  return sharedCodeInfoArray.map((codeInfo) => ({
    key: codeInfo.key,
    ...extractJsElements(codeInfo.code)
  }));
}

interface PreludeOptions {
  // The export being inlined. A declaration that calls it while being
  // evaluated would recurse, so it is left out.
  exportName?: string;
  // Whether the prelude may await. A declaration that awaits while being
  // evaluated is left out of a synchronous export.
  canAwait: boolean;
  // Names the rule itself binds, which the prelude reads instead of re-declaring
  ruleBindingNames: Set<string>;
}

// The module declarations `rootNames` depend on, directly or through other
// declarations, in source order
function preludeDeclarations(
  declarations: SharedCodeDeclaration[],
  rootNames: Iterable<string>,
  options: PreludeOptions
): SharedCodeDeclaration[] {
  const declarationByName = new Map(
    declarations.map((declaration) => [declaration.name, declaration])
  );

  // Every declaration that runs while `declaration` is evaluated. A function it
  // reads counts as called, so that function's whole body runs.
  const namesEvaluatedBy = (declaration: SharedCodeDeclaration) => {
    const evaluated = new Set<string>();
    const pending = [...declaration.evaluatedNames];
    let name: string | undefined;
    while ((name = pending.pop()) !== undefined) {
      const reached = declarationByName.get(name);
      if (!reached || evaluated.has(name)) continue;
      evaluated.add(name);
      pending.push(
        ...(reached.isFunction
          ? reached.referencedNames
          : reached.evaluatedNames)
      );
    }
    return evaluated;
  };

  const isLeftOut = (declaration: SharedCodeDeclaration) => {
    if (declaration.isFunction) return false;
    const evaluated = namesEvaluatedBy(declaration);
    if (options.exportName && evaluated.has(options.exportName)) return true;
    return (
      !options.canAwait &&
      [declaration.name, ...evaluated].some(
        (name) => declarationByName.get(name)?.awaits
      )
    );
  };

  const included = new Set<string>();
  const pending = [...rootNames];
  let name: string | undefined;
  while ((name = pending.pop()) !== undefined) {
    const declaration = declarationByName.get(name);
    if (
      !declaration ||
      name === options.exportName ||
      included.has(name) ||
      options.ruleBindingNames.has(name) ||
      isLeftOut(declaration)
    ) {
      continue;
    }
    included.add(name);
    pending.push(...declaration.referencedNames);
  }

  return declarations.filter((declaration) => included.has(declaration.name));
}

// An exported function as the rule declares it. Its prelude is re-declared on
// every call, as production does. A name the body reads directly gets its own
// copy; one only its helpers read comes from the rule when the rule imports it
// under the same name.
function inlinedFunction(
  localName: string,
  exportFunction: ExtractedExportFuncInfo,
  declarations: SharedCodeDeclaration[],
  sameNameImports: Set<string>
): string {
  const { name, signature, body, isAsync, referencedNames, ownNames } =
    exportFunction;
  const prelude = preludeDeclarations(declarations, referencedNames, {
    exportName: name,
    canAwait: Boolean(isAsync),
    ruleBindingNames: new Set(
      [...sameNameImports].filter(
        (importedName) => !referencedNames.includes(importedName)
      )
    )
  });
  const asyncPrefix = isAsync ? 'async ' : '';
  const preludeCode = prelude.map((declaration) => declaration.code);

  const shadowsPrelude = prelude.some((declaration) =>
    ownNames.includes(declaration.name)
  );
  if (!shadowsPrelude) {
    return `${asyncPrefix}function ${localName}${signature} {\n${[
      ...preludeCode,
      body
    ].join('\n')}\n}`;
  }

  // A parameter or local shares a name with a prelude declaration, so the
  // prelude goes in an enclosing scope where helpers still see the module's
  // declaration
  const preludeAwaits = prelude.some((declaration) => declaration.awaits);
  const factory = `(${preludeAwaits ? 'async ' : ''}() => {\n${preludeCode.join(
    '\n'
  )}\nreturn ${asyncPrefix}function ${name}${signature} {\n${body}\n};\n})()`;
  const implementation = preludeAwaits ? `(await ${factory})` : factory;
  return `${asyncPrefix}function ${localName}${signature} {\nreturn ${implementation}.apply(this, arguments);\n}`;
}

// The computed constants a rule imports from one module, evaluated together
// once so a declaration they share runs a single time
function inlinedComputedConstants(
  importedConstants: { importedName: string; localName: string }[],
  declarations: SharedCodeDeclaration[]
): string {
  const prelude = preludeDeclarations(
    declarations,
    importedConstants.map(({ importedName }) => importedName),
    { canAwait: true, ruleBindingNames: new Set() }
  );
  const isAsync = prelude.some((declaration) => declaration.awaits);
  const bindings = importedConstants
    .map(({ importedName, localName }) =>
      importedName === localName
        ? importedName
        : `${importedName}: ${localName}`
    )
    .join(', ');
  const returned = [
    ...new Set(importedConstants.map(({ importedName }) => importedName))
  ].join(', ');
  const evaluation = `(${isAsync ? 'async ' : ''}() => {\n${prelude
    .map((declaration) => declaration.code)
    .join('\n')}\nreturn { ${returned} };\n})()`;

  return `const { ${bindings} } = ${isAsync ? 'await ' : ''}${evaluation};`;
}

function replaceImportsWithDefinitions(
  code: string,
  extractedSharedCodeInfo: ExtractedSharedCodeInfo[]
): string {
  const lines = code.split('\n');
  const importLinesToRemove = new Set<number>();
  const importsByModule = new Map<
    ExtractedSharedCodeInfo,
    { importedName: string; localName: string }[]
  >();

  const parsedNodes = getAcornParsedNodes(code);

  if (!parsedNodes) {
    return code;
  }

  walk.simple(parsedNodes, {
    ImportDeclaration(node: any) {
      const key = node.source.value;
      const sharedModule = extractedSharedCodeInfo.find(
        (r: any) => r.key === key
      );
      if (!sharedModule) return;

      const start = node.loc.start.line - 1;
      const end = node.loc.end.line - 1;

      for (let i = start; i <= end; i++) {
        importLinesToRemove.add(i);
      }

      const moduleImports = importsByModule.get(sharedModule) ?? [];
      importsByModule.set(sharedModule, moduleImports);

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          moduleImports.push({
            importedName: specifier.imported.name,
            localName: specifier.local.name
          });
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          moduleImports.push({
            importedName: specifier.local.name,
            localName: specifier.local.name
          });
        }
      }
    }
  });

  const definitions: string[] = [];
  for (const [sharedModule, moduleImports] of importsByModule) {
    const sameNameImports = new Set(
      moduleImports
        .filter(({ importedName, localName }) => importedName === localName)
        .map(({ importedName }) => importedName)
    );
    const importedComputedConstants: typeof moduleImports = [];

    for (const { importedName, localName } of moduleImports) {
      const matchedVar = sharedModule.exportVariables.find(
        (v) => v.name === importedName
      );
      if (matchedVar?.isComputed) {
        importedComputedConstants.push({ importedName, localName });
        continue;
      }
      if (matchedVar) {
        // If value is a plain JS value (string/number/boolean/null/array/object),
        // print JS code accordingly. For plain strings we output single-quoted literals.
        definitions.push(
          `const ${localName} = ${printJsValue(matchedVar.value)};`
        );
        continue;
      }

      const matchedFunc = sharedModule.exportFunctions.find(
        (f) => f.name === importedName
      );
      if (matchedFunc) {
        definitions.push(
          inlinedFunction(
            localName,
            matchedFunc,
            sharedModule.declarations,
            sameNameImports
          )
        );
      }
    }

    if (importedComputedConstants.length) {
      definitions.push(
        inlinedComputedConstants(
          importedComputedConstants,
          sharedModule.declarations
        )
      );
    }
  }

  const remainingLines = lines.filter(
    (_, idx) => !importLinesToRemove.has(idx)
  );

  return [...definitions, '', ...remainingLines].join('\n');
}

// Used to warn about logic rule errors
export const handleRuleError = (errorMessage: string, logicRule: LogicRule) => {
  // log that a specific rule had an error, log it to warning console
  console.warn(
    `Error while running logic rule: ${logicRule.name}`,
    `  On Event: ${logicRule.trigger_event}`,
    `  Error Message: ${errorMessage ?? ''}`
  );
};

export const runServerSideLogic = async (
  logicRule: ServerSideLogicRule,
  client: any,
  isDraft: boolean
) => {
  // for now, skip running server-side logic rules if they're draft rules
  if (isDraft) {
    return;
  }
  const response = await client.runServerSideLogicRule(logicRule.id);
  if (response?.field_data) {
    setFieldValues(response.field_data, true, true);
  }
  if (response?.file_values) {
    processFileValues(response.file_values);
    rerenderAllForms();
  }
  if (response?.error) {
    handleRuleError(response?.error, logicRule);
  }
};

const AsyncFunction = async function () {}.constructor;

export const runClientSideLogic = async (
  logicRule: ClientSideLogicRule,
  client: any,
  extractedSharedCodeInfo: ExtractedSharedCodeInfo[],
  internalState: FormInternalState,
  connectorFields: any,
  props: Record<string, any>,
  // Tool inputs exposed to the rule code as `feathery.params`. Omitted for
  // ordinary event-triggered rule execution.
  inputParams?: Record<string, any>
): Promise<any> => {
  let logicRuleCode = logicRule.code;

  if (extractedSharedCodeInfo.length > 0) {
    logicRuleCode = replaceImportsWithDefinitions(
      logicRule.code,
      extractedSharedCodeInfo
    );
  }

  // Note:
  // AsyncFunction is nice and tidy but was throwing an error when trying to use await at
  // the top level of the user code.
  // The error was: Uncaught (in promise) SyntaxError: await is only valid in async functions and the top level bodies of modules.
  // So, then tried eval instead, but had a serious issue with the webpacked published
  // lib which was just invalid. So, now wrapping the rule code
  // in an async function and calling it immediately from within an AsyncFunction.
  const asyncWrappedCode = `return (async () => { ${logicRuleCode}\n })()`;

  // Do not inject field globals that are invalid js identifiers or that collide
  // with a javascript or browser reserved word. This avoids validation errors
  // should they try to use it in a rule. However, even if they do not use it
  // in a rule, the runtime injects that field and this causes an exception
  // at runtime due to the reserved word being used or invalid identifier.

  const injectableFields = Object.entries(internalState?.fields ?? {})
    .filter(([key]) => isValidFieldIdentifier(key))
    .reduce((acc, [key, field]) => {
      acc[key] = field;
      return acc;
    }, {} as Record<string, Field>);
  // @ts-ignore
  const fn = new AsyncFunction(
    'feathery',
    // pass in all the fields as arguments so they are globals in the rule code
    ...Object.keys(injectableFields),
    asyncWrappedCode
  );
  // Return the rule code's resolved value for tool dispatch (event execution
  // ignores it), failures propagate to the caller which reports them once
  return await fn(
    {
      ...props,
      http: httpHelpers(client, connectorFields),
      params: inputParams ?? {}
    },
    ...Object.values(injectableFields)
  );
};

type RunLogicRuleResult = LogicRuleTransportResult;

// A rule is user-authored JavaScript and may return any runtime value.
// Recursively sanitize every dynamic value before it reaches addToolOutput.
// No client-side size clipping, the server digests oversized tool results
// with full-fidelity recall via queryOutput
const asText = (value: unknown): string =>
  String(sanitizeTransportValue(String(value ?? '')));

const sanitizeFieldChanges = (changes: FieldChange[]): FieldChange[] =>
  changes.map((change) => ({
    key: asText(change.key),
    before: sanitizeTransportValue(change.before),
    after: sanitizeTransportValue(change.after),
    ...(change.documentHint
      ? {
          documentHint: {
            ...(change.documentHint.anchor
              ? { anchor: asText(change.documentHint.anchor) }
              : {}),
            ...(change.documentHint.describes
              ? { describes: asText(change.documentHint.describes) }
              : {})
          }
        }
      : {})
  }));

const logicRuleTransportResult = (input: {
  ruleId: string;
  ruleName: string;
  returnValue?: unknown;
  changedFieldDetails?: ChangedFieldDetail[];
  documentPresent?: boolean;
  describeField?: (key: string) => string | undefined;
  error?: unknown;
}): RunLogicRuleResult => {
  const fieldChanges = composeFieldChanges(input.changedFieldDetails ?? [], {
    explicitUpdates: (input.returnValue as any)?.updates,
    includeDocumentHints: input.documentPresent === true,
    describeField: input.describeField
  });
  return {
    ok: !input.error,
    rule: {
      id: asText(input.ruleId) || 'unknown-rule',
      name: asText(input.ruleName) || 'Unavailable rule'
    },
    result: sanitizeTransportValue(
      withoutEmbeddedFieldUpdates(input.returnValue)
    ),
    fieldChanges: sanitizeFieldChanges(fieldChanges),
    ...(input.error ? { error: asText(input.error) } : {})
  };
};

// Snapshot every field's value (JSON-serialized) so we can diff after a rule
// runs and report which fields it actually touched. Serialized (not live
// references) so in-place mutations by rule code can't corrupt the snapshot.
const snapshotFieldValues = (
  state: FormInternalState
): Record<string, string> => {
  const out: Record<string, string> = {};
  Object.entries(state?.fields ?? {}).forEach(([key, field]) => {
    try {
      out[key] = JSON.stringify((field as any)?.value ?? null);
    } catch {
      out[key] = '';
    }
  });
  return out;
};

// Recover a plain value from a snapshot entry (inverse of snapshotFieldValues'
// JSON.stringify; '' marks an unserializable value and maps to null).
const parseSnapshotValue = (serialized: string | undefined): any => {
  if (!serialized) return null;
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
};

// Name a changed field for the document-reflection fallback: the field key
// plus its admin-authored label when the form declares one. Used as the
// `describes` semantic-search query when the pre-rule text isn't found in the
// document (the document may hold an older rendering of the field).
const describeFieldForDocument = (
  state: FormInternalState,
  key: string
): string => {
  let label: string | undefined;
  try {
    for (const step of Object.values((state as any)?.steps ?? {})) {
      const match = ((step as any)?.servar_fields ?? []).find(
        (f: any) => f?.servar?.key === key
      );
      if (match) {
        if (typeof match?.servar?.name === 'string') label = match.servar.name;
        break;
      }
    }
  } catch {
    // Hidden fields and partially-seeded forms have no servar; the key-only
    // description below still names the field.
  }
  const labelPart = label && label !== key ? ` ("${label}")` : '';
  return `the rendered value of form field '${key}'${labelPart}`;
};

const diffChangedFieldDetails = (
  before: Record<string, string>,
  after: Record<string, string>
): ChangedFieldDetail[] => {
  const changed: ChangedFieldDetail[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.forEach((key) => {
    if (before[key] !== after[key])
      changed.push({
        key,
        oldValue: parseSnapshotValue(before[key]),
        newValue: parseSnapshotValue(after[key])
      });
  });
  return changed;
};

// Execute a single `trigger_event === 'tool'` rule by id for assistant tool
// dispatch, client-side only (the serializer and the catalog both exclude
// server_side). Returns the rule's resolved value plus per-field old->new
// details diffed from a pre-invoke snapshot. Never throws, failures surface
// via the `error` field
export const runLogicRuleById = async (
  ruleId: string,
  inputParams: Record<string, any> = {},
  formUuid?: string,
  options: { documentPresent?: boolean } = {}
): Promise<RunLogicRuleResult> => {
  // Resolve the owning form. When no uuid is given, fall back to the only
  // loaded form (the common single-form host case).
  const uuids = Object.keys(internalStateStore);
  const resolvedUuid =
    formUuid && internalStateStore[formUuid]
      ? formUuid
      : !formUuid && uuids.length === 1
      ? uuids[0]
      : formUuid;
  const state = resolvedUuid ? internalStateStore[resolvedUuid] : undefined;

  if (!state) {
    return logicRuleTransportResult({
      ruleId,
      ruleName: 'Unavailable rule',
      error: 'Form has not loaded yet.'
    });
  }

  const rule = (state.logicRules ?? []).find((r) => r.id === ruleId);
  if (!rule) {
    return logicRuleTransportResult({
      ruleId,
      ruleName: 'Unavailable rule',
      error: `Logic rule '${ruleId}' was not found on this form.`
    });
  }
  // Fail closed, a server_side rule ships no code so running it here would
  // silently succeed as a no-op
  if (rule.server_side) {
    return logicRuleTransportResult({
      ruleId: rule.id,
      ruleName: rule.name,
      error: 'Server-side rules cannot run as assistant tools.'
    });
  }

  const before = snapshotFieldValues(state);

  try {
    const props = {
      ...getFormContext(resolvedUuid as string),
      ...getPrivateActions(resolvedUuid as string)
    };
    const returnValue = await runClientSideLogic(
      rule,
      state.client,
      (state as any).extractedSharedCodeInfo ?? [],
      state,
      (state as any).connectorFields,
      props,
      inputParams
    );
    const changedFieldDetails = diffChangedFieldDetails(
      before,
      snapshotFieldValues(state)
    );
    return logicRuleTransportResult({
      ruleId: rule.id,
      ruleName: rule.name,
      returnValue,
      changedFieldDetails,
      documentPresent: options.documentPresent,
      describeField: (key) => describeFieldForDocument(state, key)
    });
  } catch (e: any) {
    const message = e?.reason?.message ?? e?.error?.message ?? e?.message;
    handleRuleError(message, rule);
    return logicRuleTransportResult({
      ruleId: rule.id,
      ruleName: rule.name,
      error: message ?? 'Logic rule failed.'
    });
  }
};

import { parse as acornParse, Program } from 'acorn';
import { parse as acornLooseParse } from 'acorn-loose';
import * as walk from 'acorn-walk';
import {
  ExtractedExportFuncInfo,
  ExtractedExportVarInfo,
  ExtractedSharedCodeInfo,
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
import {
  ChangedFieldDetail,
  composeDerivedRuleUpdates,
  DerivedRuleUpdate,
  RULE_FIELDS_CHANGED_NOTE
} from '../assistant/tools/assistantToolDispatch';

export function getAcornParsedNodes(input: string): Program | null {
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

function extractJsElements(code: string): {
  exportVariables: ExtractedExportVarInfo[];
  exportFunctions: ExtractedExportFuncInfo[];
} {
  const variableMap = new Map<string, { declaration: string; value: string }>();
  const functionMap = new Map<
    string,
    { signature: string; body: string; isAsync?: boolean }
  >();
  const exportFunctions: ExtractedExportFuncInfo[] = [];
  const exportVariables: ExtractedExportVarInfo[] = [];

  const parsedNodes = getAcornParsedNodes(code);
  if (!parsedNodes) {
    console.warn('Failed to parse logic rule code');
    return { exportVariables, exportFunctions };
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
          const { signature, body, isAsync } = buildFnParts(decl.init);
          functionMap.set(name, { signature, body, isAsync });
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
      const isAsync = node.async;

      functionMap.set(name, {
        signature: `(${params.join(', ')})`,
        body,
        isAsync
      });
    }

    // 3) Exported function declarations
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration'
    ) {
      const funcNode = node.declaration;
      const isAsync = funcNode.async;
      const name = funcNode.id.name;
      const params = funcNode.params.map((p: any) => paramText(p));
      const bodyStart = funcNode.body.start + 1;
      const bodyEnd = funcNode.body.end - 1;
      const body = code.slice(bodyStart, bodyEnd).trim();

      // Register exported function first
      functionMap.set(name, {
        signature: `(${params.join(', ')})`,
        body,
        isAsync
      });

      // Build minimal dependency prelude
      const used = extractReferencedIdentifiers(funcNode.body);
      const prelude: string[] = [];
      const seen = new Set<string>();

      for (const id of used) {
        if (id === name || seen.has(id)) continue;

        const fn = functionMap.get(id);
        if (fn) {
          prelude.push(
            `${fn.isAsync ? 'async ' : ''}function ${id}${fn.signature} {\n${
              fn.body
            }\n}`
          );
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
        body: prelude.concat([body]).join('\n'),
        isAsync
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
          const { signature, body, isAsync } = buildFnParts(decl.init);

          // Register in functionMap so other exports can depend on it
          functionMap.set(name, { signature, body, isAsync });

          const used = extractReferencedIdentifiers(decl.init.body);
          const prelude: string[] = [];
          const seen = new Set<string>();

          for (const id of used) {
            if (id === name || seen.has(id)) continue;

            const fn = functionMap.get(id);
            if (fn) {
              prelude.push(
                `${fn.isAsync ? 'async ' : ''}function ${id}${
                  fn.signature
                } {\n${fn.body}\n}`
              );
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
            body: prelude.concat([body]).join('\n'),
            isAsync
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
  sharedCodeInfoArray: SharedCodeInfo[]
): ExtractedSharedCodeInfo[] {
  return sharedCodeInfoArray
    .filter((codeInfo) => codeInfo.valid)
    .map((codeInfo) => ({
      key: codeInfo.key,
      ...extractJsElements(codeInfo.code)
    }));
}

export function replaceImportsWithDefinitions(
  code: string,
  extractedSharedCodeInfo: ExtractedSharedCodeInfo[]
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
      const rule = extractedSharedCodeInfo.find((r: any) => r.key === key);
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
            `${matchedFunc.isAsync ? 'async ' : ''}function ${localName}${
              matchedFunc.signature
            } {\n${matchedFunc.body}\n}`
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
  // Capture the rule code's resolved return value so callers (e.g. Robin tool
  // dispatch via runLogicRuleById) can use it; ordinary event execution simply
  // ignores it. Tool execution must propagate failures to its caller.
  let returnValue: any;
  try {
    returnValue = await fn(
      {
        ...props,
        http: httpHelpers(client, connectorFields),
        params: inputParams ?? {}
      },
      ...Object.values(injectableFields)
    );
  } catch (e: any) {
    // catch unhandled rejections in async user code (if a promise is returned)
    // handle any errors in async code that actually returns a promise
    handleRuleError(e.message, logicRule);
    throw e;
  }
  return returnValue;
};

export type RunLogicRuleResult = {
  changedFields: string[];
  // Old->new per changed field (oldValue from the pre-invoke snapshot, so it
  // is available for BOTH client- and server-side rules). Parallel to
  // changedFields, which is kept as-is for existing readers.
  changedFieldDetails?: ChangedFieldDetail[];
  // Document updates derived from the rule's field changes on BOTH paths
  // ({ field, previous?, value, describes? }): the server lambda's return
  // value never reaches the client (v1), and a client rule may mutate fields
  // without returning { updates }. Deduped against returnValue.updates.
  derivedUpdates?: DerivedRuleUpdate[];
  // Always false when present (rules never edit the open document), attached
  // with `note` whenever the rule changed form fields so the model keeps
  // "the rule ran" and "the document shows it" as two separate facts.
  documentEdited?: false;
  note?: string;
  returnValue?: any;
  error?: string;
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

// Execute a single logic rule on demand by its id - the entrypoint the
// assistant uses to invoke designer-defined `trigger_event === 'tool'` rules.
// Resolves the rule from internalState.logicRules and branches on server_side:
//   - server_side: true  -> featheryClient.runServerSideLogicRule(id, {input_params})
//                           (returnValue stays undefined in v1)
//   - server_side: false -> runClientSideLogic with params exposed to the rule
//                           code as `feathery.params`, capturing its return value
// Returns the set of field keys the rule changed (plus per-field old->new
// details from the pre-invoke snapshot, and - server-side only - document
// updates derived from field_data) plus the client-side rule's resolved
// return value. Never throws - failures surface via the `error` field.
export const runLogicRuleById = async (
  ruleId: string,
  inputParams: Record<string, any> = {},
  formUuid?: string
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
    return { changedFields: [], error: 'Form has not loaded yet.' };
  }

  const rule = (state.logicRules ?? []).find((r) => r.id === ruleId);
  if (!rule) {
    return {
      changedFields: [],
      error: `Logic rule '${ruleId}' was not found on this form.`
    };
  }

  const before = snapshotFieldValues(state);

  try {
    if (rule.server_side) {
      const response = await (state.client as any).runServerSideLogicRule(
        rule.id,
        {
          input_params: inputParams
        }
      );
      if (response?.field_data) {
        setFieldValues(response.field_data, true, true);
      }
      if (response?.file_values) {
        processFileValues(response.file_values);
        rerenderAllForms();
      }
      if (response?.error) {
        handleRuleError(response.error, rule);
        return { changedFields: [], error: String(response.error) };
      }
      // Prefer the backend's authoritative field_data (new values) paired
      // with the pre-invoke snapshot (old values); fall back to a diff. A
      // field_data entry echoing the pre-rule value is not a change - only
      // fields the rule actually moved are surfaced.
      const fieldData = response?.field_data as Record<string, any> | undefined;
      const changedFieldDetails: ChangedFieldDetail[] = fieldData
        ? Object.keys(fieldData)
            .filter((key) => {
              let serialized = '';
              try {
                serialized = JSON.stringify(fieldData[key] ?? null);
              } catch {}
              return serialized !== (before[key] ?? JSON.stringify(null));
            })
            .map((key) => ({
              key,
              oldValue: parseSnapshotValue(before[key]),
              newValue: fieldData[key]
            }))
        : diffChangedFieldDetails(before, snapshotFieldValues(state));
      // A server-side rule has no returnValue to hand back, so instead derive
      // document updates ({ field, previous, value }) from the field diff. That
      // makes old->new exact-replace work without the rule returning { updates }.
      const derivedUpdates = composeDerivedRuleUpdates(changedFieldDetails, {
        describeField: (key) => describeFieldForDocument(state, key)
      });
      return {
        changedFields: changedFieldDetails.map((d) => d.key),
        changedFieldDetails,
        ...(derivedUpdates.length > 0 ? { derivedUpdates } : {}),
        ...(changedFieldDetails.length > 0
          ? { documentEdited: false as const, note: RULE_FIELDS_CHANGED_NOTE }
          : {})
      };
    }

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
    // Client rules may change fields without returning an explicit updates
    // payload. Derive the same safe old->new document updates as the server
    // path so Robin does not claim success while leaving the document stale.
    // A field the rule ALSO covered in an explicitly returned updates array
    // is deduped so the same edit is never applied twice.
    const derivedUpdates = composeDerivedRuleUpdates(changedFieldDetails, {
      explicitUpdates: (returnValue as any)?.updates,
      describeField: (key) => describeFieldForDocument(state, key)
    });
    return {
      changedFields: changedFieldDetails.map((d) => d.key),
      changedFieldDetails,
      ...(derivedUpdates.length > 0 ? { derivedUpdates } : {}),
      ...(changedFieldDetails.length > 0
        ? { documentEdited: false as const, note: RULE_FIELDS_CHANGED_NOTE }
        : {}),
      returnValue
    };
  } catch (e: any) {
    const message = e?.reason?.message ?? e?.error?.message ?? e?.message;
    handleRuleError(message, rule);
    return { changedFields: [], error: message ?? 'Logic rule failed.' };
  }
};

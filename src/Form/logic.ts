import { SharedCodeModules, linkSharedCode } from './sharedCode';
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
  sharedCodeModules: SharedCodeModules,
  internalState: FormInternalState,
  connectorFields: any,
  props: Record<string, any>,
  // Tool inputs exposed to the rule code as `feathery.params`. Omitted for
  // ordinary event-triggered rule execution.
  inputParams?: Record<string, any>
): Promise<any> => {
  const { code: logicRuleCode, prelude } = linkSharedCode(
    logicRule.code,
    sharedCodeModules
  );

  // Note:
  // AsyncFunction is nice and tidy but was throwing an error when trying to use await at
  // the top level of the user code.
  // The error was: Uncaught (in promise) SyntaxError: await is only valid in async functions and the top level bodies of modules.
  // So, then tried eval instead, but had a serious issue with the webpacked published
  // lib which was just invalid. So, now wrapping the rule code
  // in an async function and calling it immediately from within an AsyncFunction.
  // Shared code runs outside the rule's scope, so it can't see the rule's variables
  const asyncWrappedCode = `${prelude}\nreturn (async () => { ${logicRuleCode}\n })()`;

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
      state.sharedCodeModules ?? {},
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

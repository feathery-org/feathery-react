import internalState from '../internalState';
import { runLogicRuleById } from '../../Form/logic';
import { FieldChange } from '../logicRuleResult';
import { LogicRule, ToolRuleParameter } from '../../types/Form';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  getLiveStepKey,
  InlineErrorReport,
  NOT_LOADED_MESSAGE,
  snapshotInlineErrors
} from './utils';

export type RunLogicRuleParams = Record<string, string | number | boolean>;

export type RunLogicRuleActionResult =
  | {
      ok: true;
      rule: { id: string; name: string };
      result: unknown;
      fieldChanges: FieldChange[];
      navigated: { fromStepKey: string; toStepKey: string } | null;
      fieldErrors?: InlineErrorReport[];
    }
  | {
      ok: false;
      reason:
        | 'not_loaded'
        | 'unknown_rule'
        | 'invalid_params'
        | 'action_failed';
      message: string;
    };

// The rules a filler may run: designer tool rules that are live and have client code
const isRunnableToolRule = (rule: LogicRule): boolean =>
  rule.trigger_event === 'tool' &&
  rule.enabled !== false &&
  rule.valid !== false &&
  !rule.server_side;

function validateParams(
  parameters: ToolRuleParameter[],
  params: RunLogicRuleParams
): string | null {
  const declared = new Map(parameters.map((p) => [p.name, p]));
  const unknown = Object.keys(params).filter((name) => !declared.has(name));
  if (unknown.length > 0) {
    return `Unknown params: ${unknown.join(', ')}. Declared: ${
      [...declared.keys()].join(', ') || '(none)'
    }.`;
  }
  for (const parameter of parameters) {
    const value = params[parameter.name];
    if (value === undefined) {
      if (parameter.required) return `Param '${parameter.name}' is required.`;
      continue;
    }
    if (parameter.type === 'file') {
      return `Param '${parameter.name}' takes a file, which cannot be supplied for the person.`;
    }
    if (typeof value !== parameter.type) {
      return `Param '${parameter.name}' expects a ${parameter.type}.`;
    }
  }
  return null;
}

export async function runLogicRule(
  formUuid: string,
  ruleId: string,
  params: RunLogicRuleParams = {}
): Promise<RunLogicRuleActionResult> {
  const state = internalState[formUuid];
  if (!state?.currentStep || !state.logicRules) {
    return { ok: false, reason: 'not_loaded', message: NOT_LOADED_MESSAGE };
  }

  const rule = state.logicRules.find((r) => r.id === ruleId);
  if (!rule || !isRunnableToolRule(rule)) {
    return {
      ok: false,
      reason: 'unknown_rule',
      message: `'${ruleId}' is not an action this form offers right now.`
    };
  }
  const paramsError = validateParams(
    rule.metadata?.tool?.parameters ?? [],
    params
  );
  if (paramsError) {
    return { ok: false, reason: 'invalid_params', message: paramsError };
  }

  const fromStepKey = getLiveStepKey(state) ?? '';
  const errorsBefore = snapshotInlineErrors(state);
  const run = await runLogicRuleById(ruleId, params, formUuid);
  if (!run.ok) {
    return {
      ok: false,
      reason: 'action_failed',
      message: run.error ?? 'The action failed.'
    };
  }

  const toStepKey = getLiveStepKey(state) ?? fromStepKey;
  await awaitPendingInlineErrors(state);
  const fieldErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(state)
  );
  return {
    ok: true,
    rule: run.rule,
    result: run.result,
    fieldChanges: run.fieldChanges,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(fieldErrors.length > 0 ? { fieldErrors } : {})
  };
}

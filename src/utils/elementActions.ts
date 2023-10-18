import { ContextOnAction, ContextOnChange, ContextOnView } from '../types/Form';
import internalState from './internalState';

export const ACTION_ADD_REPEATED_ROW = 'add_repeated_row';
export const ACTION_BACK = 'back';
export const ACTION_PURCHASE_PRODUCTS = 'purchase_products';
export const ACTION_SELECT_PRODUCT_TO_PURCHASE = 'select_product_to_purchase';
export const ACTION_REMOVE_PRODUCT_FROM_PURCHASE =
  'remove_product_from_purchase';
export const ACTION_LOGOUT = 'logout';
export const ACTION_NEXT = 'next';
export const ACTION_NEW_SUBMISSION = 'new_submission';
export const ACTION_OAUTH_LOGIN = 'trigger_oauth_login';
export const ACTION_REMOVE_REPEATED_ROW = 'remove_repeated_row';
export const ACTION_SEND_MAGIC_LINK = 'send_magic_link';
export const ACTION_SEND_SMS = 'send_sms_code';
export const ACTION_STORE_FIELD = 'store_field_value';
export const ACTION_TRIGGER_ARGYLE = 'trigger_argyle';
export const ACTION_TRIGGER_PLAID = 'trigger_plaid';
export const ACTION_URL = 'url';
export const ACTION_VERIFY_SMS = 'verify_sms';

export const REQUIRED_FLOW_ACTIONS = {
  [ACTION_TRIGGER_ARGYLE]: 'You must authorize Argyle before proceeding',
  [ACTION_TRIGGER_PLAID]: 'You must authorize Plaid before proceeding'
};

export function hasFlowActions(actions: any[]) {
  return actions.find((action) => action.type in REQUIRED_FLOW_ACTIONS);
}

export const stepEvents = ['submit', 'load'];
export const elementEvents = ['view', 'change', 'action'];

// Apply steps and elements filters to the applicable event types
// to determine if the rule should be run.  Some event types support
// neither filter and will always run.
export function canRunAction(
  logicRule: any,
  internalId: string,
  props: any,
  containerId: string | undefined
) {
  const currentStepId = (internalState[internalId]?.currentStep ?? {}).id;

  if (![...stepEvents, ...elementEvents].includes(logicRule.trigger_event))
    return true;
  if (
    stepEvents.includes(logicRule.trigger_event) &&
    (logicRule.steps.length === 0 ||
      (logicRule.steps.length > 0 && logicRule.steps.includes(currentStepId)))
  )
    return true;
  if (
    logicRule.trigger_event === 'view' &&
    logicRule.elements.includes(
      (props as ContextOnView).visibilityStatus.elementId
    )
  )
    return true;
  if (
    logicRule.trigger_event === 'change' &&
    logicRule.elements.includes(
      (props as ContextOnChange | ContextOnAction).trigger._servarId ?? ''
    )
  )
    return true;

  const runAfterClick = logicRule.metadata?.after_click;
  const isRightSequence =
    (props.beforeClickActions && !runAfterClick) ||
    (!props.beforeClickActions && runAfterClick);
  if (
    logicRule.trigger_event === 'action' &&
    isRightSequence &&
    (logicRule.elements.includes(
      (props as ContextOnChange | ContextOnAction).trigger.id
    ) ||
      logicRule.elements.includes(containerId ?? ''))
  )
    return true;

  return false;
}

// Lower execution order actions are executed before higher execution order actions.
// Actions within a execution level are executed in the order they are defined by the designer
// relative to other actions in the same execution level.
// Actions with no execution order are executed FIRST (before those with specific execution orders)
// and in the order they are defined by the designer relative to other actions with
// no execution order.
export const ACTION_EXECUTION_ORDER = {
  [ACTION_URL]: 1,
  [ACTION_BACK]: 2,
  [ACTION_NEXT]: 2,
  [ACTION_OAUTH_LOGIN]: 2
};

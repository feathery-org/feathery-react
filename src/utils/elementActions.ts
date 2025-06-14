import { ContextOnAction, ContextOnChange, ContextOnView } from '../types/Form';

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
export const ACTION_GENERATE_ENVELOPES = 'open_fuser_envelopes';
export const ACTION_REMOVE_REPEATED_ROW = 'remove_repeated_row';
export const ACTION_GENERATE_QUIK_DOCUMENTS = 'generate_quik_documents';
export const ACTION_SEND_MAGIC_LINK = 'send_magic_link';
export const ACTION_SEND_SMS_CODE = 'send_sms_code';
export const ACTION_SEND_EMAIL_CODE = 'send_email_code';
export const ACTION_SEND_SMS_MESSAGE = 'send_sms_message';
export const ACTION_STORE_FIELD = 'store_field_value';
export const ACTION_TRIGGER_ARGYLE = 'trigger_argyle';
export const ACTION_TRIGGER_FLINKS = 'trigger_flinks';
export const ACTION_TRIGGER_PLAID = 'trigger_plaid';
export const ACTION_TRIGGER_PERSONA = 'trigger_persona';
export const ACTION_ALLOY_VERIFY_ID = 'alloy_verify_id';
export const ACTION_SCHWAB_CREATE_CONTACT = 'schwab_create_contact';
export const ACTION_URL = 'url';
export const ACTION_VERIFY_EMAIL = 'verify_email';
export const ACTION_VERIFY_SMS = 'verify_sms';
export const ACTION_VERIFY_COLLABORATOR = 'verify_collaborator';
export const ACTION_INVITE_COLLABORATOR = 'invite_collaborator';
export const ACTION_REWIND_COLLABORATION = 'rewind_collaboration';
export const ACTION_AI_EXTRACTION = 'ai_document_extract';
export const ACTION_TELESIGN_SILENT_VERIFICATION =
  'telesign_silent_verification';
export const ACTION_TELESIGN_PHONE_TYPE = 'telesign_phone_type';
export const ACTION_TELESIGN_VOICE_OTP = 'telesign_voice_otp';
export const ACTION_TELESIGN_SMS_OTP = 'telesign_sms_otp';
export const ACTION_TELESIGN_VERIFY_OTP = 'telesign_verify_otp';
export const NAVIGATION_ACTIONS = [ACTION_NEXT, ACTION_BACK, ACTION_URL];

export const REQUIRED_FLOW_ACTIONS = {
  [ACTION_TRIGGER_ARGYLE]: 'You must authorize Argyle before proceeding',
  [ACTION_TRIGGER_PLAID]: 'You must authorize Plaid before proceeding',
  [ACTION_TRIGGER_FLINKS]: 'You must authorize Flinks before proceeding',
  [ACTION_ALLOY_VERIFY_ID]: 'You must verify your ID before proceeding',
  [ACTION_TRIGGER_PERSONA]: 'You must verify your ID before proceeding'
};

export function hasFlowActions(actions: any[]) {
  return actions.find((action) => action.type in REQUIRED_FLOW_ACTIONS);
}

export const stepEvents = ['submit', 'load'];
export const elementEvents = ['view', 'change', 'action'];

export function isRunnableStepEventRule(rule: any, curStepId: string) {
  return (
    stepEvents.includes(rule.trigger_event) &&
    (rule.steps.length === 0 ||
      (rule.steps.length > 0 && rule.steps.includes(curStepId)))
  );
}

// Apply steps and elements filters to the applicable event types
// to determine if the rule should be run.  Some event types support
// neither filter and will always run.
export function canRunAction(
  logicRule: any,
  currentStepId: string,
  props: any,
  containerId: string | undefined
) {
  const event = logicRule.trigger_event;
  if (![...stepEvents, ...elementEvents].includes(event)) return true;

  const runAfterEvent = logicRule.metadata?.after_click;
  const key = event === 'submit' ? 'beforeSubmit' : 'beforeClickActions';
  const isRightSequence =
    (props[key] && !runAfterEvent) || (!props[key] && runAfterEvent);

  if (
    isRunnableStepEventRule(logicRule, currentStepId) &&
    !(event === 'submit' && !isRightSequence)
  )
    return true;

  if (
    event === 'view' &&
    logicRule.elements.includes(
      (props as ContextOnView).visibilityStatus.elementId
    )
  )
    return true;

  if (
    event === 'change' &&
    logicRule.elements.includes(
      (props as ContextOnChange | ContextOnAction).trigger._servarId ?? ''
    )
  )
    return true;

  return (
    event === 'action' &&
    isRightSequence &&
    (logicRule.elements.includes(
      (props as ContextOnChange | ContextOnAction).trigger.id
    ) ||
      logicRule.elements.includes(containerId ?? ''))
  );
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
  [ACTION_OAUTH_LOGIN]: 2,
  [ACTION_NEW_SUBMISSION]: 3
};

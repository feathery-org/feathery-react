export const ACTION_ADD_REPEATED_ROW = 'add_repeated_row';
export const ACTION_BACK = 'back';
export const ACTION_COLLECT_PAYMENT = 'collect_payment';
export const ACTION_CUSTOM = 'custom';
export const ACTION_LOGOUT = 'logout';
export const ACTION_NEXT = 'next';
export const ACTION_OAUTH_LOGIN = 'trigger_oauth_login';
export const ACTION_REMOVE_REPEATED_ROW = 'remove_repeated_row';
export const ACTION_SEND_MAGIC_LINK = 'send_magic_link';
export const ACTION_SEND_SMS = 'send_sms_code';
export const ACTION_STORE_FIELD = 'store_field_value';
export const ACTION_TRIGGER_ARGYLE = 'trigger_argyle';
export const ACTION_TRIGGER_PLAID = 'trigger_plaid';
export const ACTION_URL = 'url';
export const ACTION_VERIFY_SMS = 'verify_sms';

export const ACTIONS_TO_VALIDATE = [ACTION_VERIFY_SMS];
export const SUBMITTABLE_ACTIONS = [ACTION_NEXT, ACTION_CUSTOM];
export const REQUIRED_FLOW_ACTIONS = [
  ACTION_TRIGGER_ARGYLE,
  ACTION_TRIGGER_PLAID
];

export function shouldValidateStep(actions: any[]) {
  return actions.some(
    (action) =>
      ACTIONS_TO_VALIDATE.includes(action.type) ||
      (SUBMITTABLE_ACTIONS.includes(action.type) && action.submit)
  );
}

export function hasFlowActions(actions: any[]) {
  return actions.some((action) => REQUIRED_FLOW_ACTIONS.includes(action.type));
}

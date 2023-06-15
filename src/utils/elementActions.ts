export const ACTION_ADD_REPEATED_ROW = 'add_repeated_row';
export const ACTION_BACK = 'back';
export const ACTION_COLLECT_PAYMENT = 'collect_payment';
export const ACTION_PURCHASE_PRODUCTS = 'purchase_products';
export const ACTION_SELECT_PRODUCT_TO_PURCHASE = 'select_product_to_purchase';
export const ACTION_REMOVE_PRODUCT_FROM_PURCHASE =
  'remove_product_from_purchase';
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

export const REQUIRED_FLOW_ACTIONS = {
  [ACTION_TRIGGER_ARGYLE]: 'You must authorize Argyle before proceeding',
  [ACTION_TRIGGER_PLAID]: 'You must authorize Plaid before proceeding'
};

export function hasFlowActions(actions: any[]) {
  return actions.find((action) => action.type in REQUIRED_FLOW_ACTIONS);
}

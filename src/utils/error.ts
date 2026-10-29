import { featheryWindow } from './browser';
export { SDKKeyError } from '@feathery/client-utils';

const FETCH_NETWORK_ERROR_MESSAGES = [
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3571287943/
  'Failed to fetch',
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3529742129/
  'Load failed'
];

// Prefix match: a host page running Sentry's browser SDK appends " (<host>)"
export const isFetchNetworkError = (error: unknown): error is TypeError =>
  error instanceof TypeError &&
  FETCH_NETWORK_ERROR_MESSAGES.some((message) =>
    error.message.startsWith(message)
  );

export class UserIdError extends Error {
  constructor() {
    super('Invalid User ID');
    this.name = 'UserIdError';
  }
}

const handleCustomScriptError = (e: PromiseRejectionEvent | ErrorEvent) => {
  const errorReason =
    (e as PromiseRejectionEvent).reason ?? (e as ErrorEvent).error;
  // If stack is at 'eval', it is a logic rule error.
  // Note this only works for unhandledrejection events, not error events.
  console.warn(
    'Error caught in custom HTML. Error Message: ',
    errorReason.message ?? ''
  );
  e.stopPropagation();
  e.preventDefault(); // Prevent the error in the log
};

export const setCustomErrorHandler = () => {
  featheryWindow().addEventListener('error', handleCustomScriptError);
};

export const removeCustomErrorHandler = () => {
  featheryWindow().removeEventListener('error', handleCustomScriptError);
};

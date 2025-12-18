import { featheryWindow } from './browser';

export class SDKKeyError extends Error {
  constructor(message = 'Invalid SDK Key') {
    super(message);
    this.name = 'SDKKeyError';
  }
}

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

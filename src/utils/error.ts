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

export class FetchError extends Error {
  payload: any;
  constructor(message: any, payload: any = null) {
    super(message);
    this.name = 'FetchError';
    this.payload = payload;
  }
}

export function parseError(err: any) {
  if (Array.isArray(err) && err.length) {
    const payloadError = err[0];
    if (typeof payloadError === 'object' && 'message' in payloadError) {
      return payloadError.message;
    } else return 'Invalid';
  } else if (err.message) return err.message;
  else return err.toString();
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

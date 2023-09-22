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

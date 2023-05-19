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

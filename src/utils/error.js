export class SDKKeyError extends Error {
  constructor() {
    super('Invalid SDK Key');
    this.name = 'SDKKeyError';
  }
}

export class UserKeyError extends Error {
  constructor() {
    super('Invalid User Key');
    this.name = 'UserKeyError';
  }
}

export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchError';
  }
}

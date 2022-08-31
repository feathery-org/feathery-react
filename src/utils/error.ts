export class SDKKeyError extends Error {
  constructor(message = 'Invalid SDK Key') {
    super(message);
    this.name = 'SDKKeyError';
  }
}

export class UserKeyError extends Error {
  constructor() {
    super('Invalid User ID');
    this.name = 'UserKeyError';
  }
}

export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchError';
  }
}

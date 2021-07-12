export class APIKeyError extends Error {
    constructor() {
        super('Invalid API Key');
        this.name = 'APIKeyError';
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

export class APIKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'APIKeyError';
    }
}

export class UserKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UserKeyError';
    }
}

export class FetchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FetchError';
    }
}

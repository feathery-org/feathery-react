export class APIKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'APIKeyError';
    }
}

export class FormKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FormKeyError';
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

export class SdkKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SdkKeyError';
    }
}

export class CompanyKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CompanyKeyError';
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

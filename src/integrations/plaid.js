import { dynamicImport } from './utils';

export function installPlaid(plaidConfig) {
    if (!plaidConfig) return Promise.resolve();
    else {
        return dynamicImport(
            'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
        );
    }
}

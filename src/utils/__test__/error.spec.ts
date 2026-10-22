import { isFetchNetworkError } from '../error';

describe('isFetchNetworkError', () => {
  it.each([
    [new TypeError('Failed to fetch'), true],
    [new TypeError('Load failed'), true],
    // Sentry's browser SDK rewrites the message to include the host
    [new TypeError('Failed to fetch (api.feathery.io)'), true],
    [new TypeError('Load failed (api.feathery.io)'), true],
    [new Error('Failed to fetch'), false],
    [new TypeError("Cannot read properties of undefined (reading 'x')"), false],
    ['Failed to fetch', false]
  ])('%p -> %p', (error, expected) => {
    expect(isFetchNetworkError(error)).toBe(expected);
  });
});

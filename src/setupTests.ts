import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

(global as any).__PACKAGE_VERSION__ = '0.0.0-test';

// jsdom exposes no web crypto, which src/utils/uuid.ts needs
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webcrypto } = require('crypto');
if (typeof (global as any).crypto === 'undefined')
  (global as any).crypto = webcrypto;

jest.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    status: 'ready',
    error: null
  })
}));

jest.mock('ai', () => ({
  DefaultChatTransport: jest.fn()
}));

configure({
  testIdAttribute: 'data-testid',
  asyncUtilTimeout: 2000
});

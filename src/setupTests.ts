import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';
import { configure } from '@testing-library/react';

(global as any).__PACKAGE_VERSION__ = '0.0.0-test';

// jsdom's jest environment omits TextEncoder/TextDecoder (present in every real
// browser and in Node); code that decodes fetched bytes needs them under test.
if (typeof (global as any).TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof (global as any).TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}

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

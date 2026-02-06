import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

(global as any).__PACKAGE_VERSION__ = '0.0.0-test';

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

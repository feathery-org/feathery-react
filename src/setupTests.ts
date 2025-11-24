import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

(global as any).__PACKAGE_VERSION__ = '0.0.0-test';

configure({
  testIdAttribute: 'data-testid',
  asyncUtilTimeout: 2000
});

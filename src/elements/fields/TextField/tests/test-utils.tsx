import React from 'react';
import { DEFAULT_MOBILE_BREAKPOINT } from '../../../styles';
jest.mock('../../../../utils/browser', () => ({
  runningInClient: jest.fn(() => false),
  featheryDoc: jest.fn(() => ({
    createElement: jest.fn(() => ({
      setAttribute: jest.fn(),
      appendChild: jest.fn()
    })),
    addEventListener: jest.fn()
  })),
  featheryWindow: jest.fn(() => ({
    matchMedia: jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }))
  })),
  isHoverDevice: jest.fn(() => false),
  isTouchDevice: jest.fn(() => false),
  isIOS: jest.fn(() => false),
  hoverStylesGuard: jest.fn((styles) => styles),
  iosScrollOnFocus: jest.fn()
}));

jest.mock('../../../components/useBorder', () => {
  return {
    __esModule: true,
    default: () => ({
      borderStyles: { active: {}, hover: {} },
      customBorder: null,
      borderId: 'test-border-id'
    })
  };
});

// Mock with state tracking
let mockFieldValue = '';

jest.mock('../../../../utils/formHelperFunctions', () => ({
  getFieldValue: jest.fn(() => {
    return { value: mockFieldValue };
  })
}));

// Helper functions for tests to control mock state
export const setMockFieldValue = (value: string) => {
  mockFieldValue = value;
};

export const getMockFieldValue = () => mockFieldValue;

export const resetMockFieldValue = () => {
  mockFieldValue = '';
};

export const mockResponsiveStyles = {
  getTarget: jest.fn(() => ({})),
  getMobileBreakpoint: jest.fn(() => DEFAULT_MOBILE_BREAKPOINT)
};

export const createMockElement = (
  type: string,
  metadata: any = {}
): {
  id: string;
  servar: { key: string; type: string; metadata: Record<string, any> } & Record<
    string,
    any
  >;
  properties: Record<string, any>;
  repeat: boolean;
} => ({
  id: 'test-field',
  servar: {
    key: 'test-key',
    type,
    metadata: {
      options: [],
      mask: null,
      prefix: '',
      suffix: '',
      allowed_characters: null,
      save_mask: false,
      custom_autocomplete: null,
      number_keypad: false,
      ...metadata
    }
  },
  properties: {
    placeholder: 'Enter text',
    tooltipText: '',
    aria_label: 'Test field'
  },
  repeat: false
});

export const createDefaultProps = (element: any, customProps: any = {}) => ({
  element,
  responsiveStyles: mockResponsiveStyles,
  fieldLabel: <label>Test Label</label>,
  elementProps: {},
  required: false,
  disabled: false,
  autoComplete: true,
  editMode: false,
  onAccept: jest.fn(),
  onEnter: jest.fn(),
  setRef: jest.fn(),
  inlineError: null,
  repeatIndex: null,
  children: null,
  ...customProps
});

// Helper to create a stateful onAccept that updates the mock field value
export const createStatefulOnAccept = () => {
  return jest.fn((value: string) => {
    setMockFieldValue(value);
  });
};

const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    // silence a warning from react-testing-library
    // See also: https://github.com/facebook/react/pull/14853
    if (/Warning.*not wrapped in act/.test(args[0])) {
      return;
    }
    // TODO (tyler): remove this when react-bootstrap is removed
    // silence a warning from react-bootstrap
    // React does not recognize the `arrowProps` prop on a DOM element. Also applies to other props
    if (
      /Warning: React does not recognize the.*prop on a DOM element/.test(
        args[0]
      )
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

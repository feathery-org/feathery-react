import React from 'react';
import { DEFAULT_MOBILE_BREAKPOINT } from '../../../styles';

// Global mocks that all field components need
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// Browser utilities mock (shared across all field components)
jest.mock('../../../../utils/browser', () => ({
  runningInClient: jest.fn(() => true),
  featheryDoc: jest.fn(() => global.document),
  featheryWindow: jest.fn(() => ({
    ...global.window,
    matchMedia: jest.fn(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn()
    }))
  })),
  isHoverDevice: jest.fn(() => false),
  isTouchDevice: jest.fn(() => false),
  isIOS: jest.fn(() => false),
  hoverStylesGuard: jest.fn((styles) => styles),
  iosScrollOnFocus: jest.fn(),
  downloadFile: jest.fn()
}));

// Border hook mock (shared across all field components)
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

// Mock field value state management
let mockFieldValue: any = '';

jest.mock('../../../../utils/fieldHelperFunctions', () => ({
  getFieldValue: jest.fn(() => {
    return { value: mockFieldValue };
  })
}));

// Shared field value management functions
export const setMockFieldValue = (value: any) => {
  mockFieldValue = value;
};

export const getMockFieldValue = () => mockFieldValue;

export const resetMockFieldValue = () => {
  mockFieldValue = '';
};

// Shared responsive styles mock
export const mockResponsiveStyles = {
  getTarget: jest.fn(() => ({})),
  getMobileBreakpoint: jest.fn(() => DEFAULT_MOBILE_BREAKPOINT),
  applyFontStyles: jest.fn(),
  // Additional methods needed for CheckboxField
  addTargets: jest.fn(),
  apply: jest.fn(),
  applyHeight: jest.fn(),
  applyWidth: jest.fn(),
  applyBorders: jest.fn(),
  applyCorners: jest.fn(),
  applyBoxShadow: jest.fn(),
  applyColor: jest.fn(),
  applySelectorStyles: jest.fn()
};

// Base element creation utility (can be extended for specific field types)
export const createBaseElement = (
  id: string,
  type: string,
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => ({
  id,
  servar: {
    key: `${id}-key`,
    type,
    metadata: {
      ...metadata
    },
    ...(metadata.max_length && { max_length: metadata.max_length }),
    ...(metadata.min_length && { min_length: metadata.min_length })
  },
  properties: {
    placeholder: 'Enter value',
    tooltipText: '',
    aria_label: 'Test field',
    ...properties
  },
  styles: {
    ...styles
  },
  repeat: false
});

// Generic default props creator
export const createFieldProps = (element: any, customProps: any = {}) => ({
  element,
  responsiveStyles: mockResponsiveStyles,
  fieldLabel: <label>Test Label</label>,
  elementProps: {},
  required: false,
  disabled: false,
  editMode: false,
  inlineError: null,
  repeatIndex: null,
  children: null,
  ...customProps
});

// Stateful onChange creators for different field types
export const createStatefulTextOnChange = () => {
  return jest.fn(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setMockFieldValue(e.target.value);
    }
  );
};

export const createStatefulFileOnChange = () => {
  return jest.fn((files: any[]) => {
    setMockFieldValue(files);
  });
};

export const createStatefulAcceptHandler = () => {
  return jest.fn((val: any) => {
    setMockFieldValue(val);
  });
};

// File testing utilities (for FileUpload tests)
export const createMockFile = (
  name: string,
  type: string,
  size = 1024,
  content = 'test content'
): File => {
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'size', {
    value: size,
    writable: false
  });
  return file;
};

export const createMockImageFile = (
  name = 'test-image.png',
  size = 1024
): File => {
  return createMockFile(name, 'image/png', size);
};

export const createMockDocumentFile = (
  name = 'test-document.pdf',
  size = 1024
): File => {
  return createMockFile(name, 'application/pdf', size);
};

export const createFileInputChangeEvent = (files: File[]) => {
  const fileList = {
    ...files,
    length: files.length,
    item: (index: number) => files[index]
  };

  Object.defineProperty(fileList, 'length', {
    value: files.length,
    writable: false
  });

  return {
    target: {
      files: fileList as FileList
    }
  };
};

export const createDragEvent = (files: File[]) => {
  const fileList = {
    ...files,
    length: files.length,
    item: (index: number) => files[index]
  };

  return {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer: {
      files: fileList as FileList
    }
  };
};

// Console error handling (shared setup)
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    // silence common testing warnings
    if (/Warning.*not wrapped in act/.test(args[0])) {
      return;
    }
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

// Shared test assertion helpers
export const expectFieldToBeDisabled = (field: HTMLElement) => {
  expect(field.hasAttribute('disabled')).toBe(true);
};

export const expectFieldToBeRequired = (field: HTMLElement) => {
  expect(field.hasAttribute('required')).toBe(true);
};

export const expectFieldToHaveMaxLength = (
  field: HTMLElement,
  maxLength: number
) => {
  expect(field.getAttribute('maxLength')).toBe(maxLength.toString());
};

export const expectFieldToHaveMinLength = (
  field: HTMLElement,
  minLength: number
) => {
  expect(field.getAttribute('minLength')).toBe(minLength.toString());
};

export const expectFieldToHaveAriaLabel = (
  field: HTMLElement,
  label: string
) => {
  expect(field.getAttribute('aria-label')).toBe(label);
};

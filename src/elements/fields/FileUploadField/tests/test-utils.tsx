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
  iosScrollOnFocus: jest.fn(),
  downloadFile: jest.fn()
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

// Mock with state tracking for file uploads
let mockFieldValue: any[] = [];

// Helper functions for tests to control mock state
export const setMockFieldValue = (value: any[]) => {
  mockFieldValue = value;
};

export const getMockFieldValue = () => mockFieldValue;

export const resetMockFieldValue = () => {
  mockFieldValue = [];
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
  styles: Record<string, any>;
  repeat: boolean;
} => ({
  id: 'test-file-upload',
  servar: {
    key: 'test-file-key',
    type,
    name: 'Upload Files',
    metadata: {
      multiple: false,
      file_types: [],
      custom_file_types: [],
      ...metadata
    },
    max_length: null // File size limit in KB
  },
  properties: {
    placeholder: 'Choose files',
    tooltipText: '',
    aria_label: 'File upload field',
    icon: null
  },
  styles: {
    hide_file_preview: false
  },
  repeat: false
});

export const createDefaultProps = (element: any, customProps: any = {}) => ({
  element,
  responsiveStyles: mockResponsiveStyles,
  required: false,
  disabled: false,
  editMode: false,
  onChange: jest.fn(),
  initialFiles: [],
  elementProps: {},
  children: null,
  ...customProps
});

// Helper to create a stateful onChange that updates the mock field value
export const createStatefulOnChange = () => {
  return jest.fn((files: any[]) => {
    setMockFieldValue(files);
  });
};

// Helper to create mock files for testing
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

// Helper to create mock image files
export const createMockImageFile = (
  name = 'test-image.png',
  size = 1024
): File => {
  return createMockFile(name, 'image/png', size);
};

// Helper to create mock document files
export const createMockDocumentFile = (
  name = 'test-document.pdf',
  size = 1024
): File => {
  return createMockFile(name, 'application/pdf', size);
};

// Helper to create file input change event
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

// Helper to create drag and drop event
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

const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    // silence a warning from react-testing-library
    if (/Warning.*not wrapped in act/.test(args[0])) {
      return;
    }
    // silence a warning from react-bootstrap
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

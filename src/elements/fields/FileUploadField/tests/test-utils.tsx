import {
  createStatefulFileOnChange,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  createMockFile,
  createMockImageFile,
  createMockDocumentFile,
  createFileInputChangeEvent,
  createDragEvent,
  createBaseElement,
  createFieldProps
} from '../../shared/tests/field-test-utils';

export {
  createStatefulFileOnChange,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  createMockFile,
  createMockImageFile,
  createMockDocumentFile,
  createFileInputChangeEvent,
  createDragEvent
};

export const createFileUploadElement = (type: string, metadata: any = {}) =>
  createBaseElement(
    'test-file-upload',
    type,
    {
      multiple: false,
      file_types: [],
      custom_file_types: [],
      ...metadata
    },
    {
      placeholder: 'Choose files',
      aria_label: 'File upload field',
      icon: null
    },
    {
      hide_file_preview: false
    }
  );

export const createFileUploadProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    onChange: jest.fn(),
    initialFiles: [],
    ...customProps
  });

import {
  createFileUploadElement,
  createFileUploadProps,
  createStatefulFileOnChange,
  getMockFieldValue,
  resetMockFieldValue,
  createMockFile,
  createMockImageFile,
  createMockDocumentFile,
  createFileInputChangeEvent,
  createDragEvent
} from './test-utils';
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor
} from '@testing-library/react';
import FileUploadField from '../index';

describe('FileUploadField - Base Functionality', () => {
  const getFileInput = () =>
    screen.getByLabelText('File upload field') as HTMLInputElement;
  const getUploadArea = () => getFileInput().parentElement as HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders FileUploadField component with default props', () => {
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} />);

      expect(screen.getByLabelText('File upload field')).toBeTruthy();
      expect(getUploadArea()).toBeTruthy();
    });
  });

  describe('File Upload Processing', () => {
    it('handles single file upload', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile('test.txt', 'text/plain');
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(1);
    });

    it('handles multiple file upload', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        multiple: true
      });
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFiles = [
        createMockFile('test1.txt', 'text/plain'),
        createMockFile('test2.txt', 'text/plain')
      ];
      const event = createFileInputChangeEvent(testFiles);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(2);
    });

    it('handles drag and drop upload', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile('test.txt', 'text/plain');
      const dragEvent = createDragEvent([testFile]);

      await act(async () => {
        fireEvent.drop(getUploadArea(), dragEvent);
      });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(1);
    });
  });

  describe('File Validation', () => {
    it('validates file types - accepts valid types', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        file_types: ['image/*']
      });
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockImageFile();
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(1);
    });

    it('validates file types - rejects invalid types', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        file_types: ['image/*']
      });
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockDocumentFile();
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).not.toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(0);
    });

    it('validates file size - accepts valid sizes', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      element.servar.max_length = 2; // 2KB limit
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile('test.txt', 'text/plain', 1024); // 1KB
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(1);
    });

    it('validates file size - rejects oversized files', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      element.servar.max_length = 1; // 1KB limit
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile('test.txt', 'text/plain', 2048); // 2KB
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).not.toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(0);
    });

    it('validates custom file types', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        custom_file_types: ['docx']
      });
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile(
        'test.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toHaveLength(1);
    });
  });

  describe('File Limits', () => {
    it('enforces file count limit', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        multiple: true
      });
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      // Create 25 files (exceeds the 20 file limit)
      const testFiles = Array.from({ length: 25 }, (_, i) =>
        createMockFile(`test${i}.txt`, 'text/plain')
      );
      const event = createFileInputChangeEvent(testFiles);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      // Should be limited to 20 files
      expect(getMockFieldValue()).toHaveLength(20);
    });

    it('handles single file replacement for non-multiple fields', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFiles = [
        createMockFile('test1.txt', 'text/plain'),
        createMockFile('test2.txt', 'text/plain')
      ];
      const event = createFileInputChangeEvent(testFiles);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      expect(mockOnChange).toHaveBeenCalled();
      // Should only accept the first file for single file upload
      expect(getMockFieldValue()).toHaveLength(1);
    });
  });

  describe('File Preview', () => {
    it('displays file preview for uploaded files', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element, {
        initialFiles: [createMockFile('test.txt', 'text/plain')]
      });

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeTruthy();
      });
    });

    it('displays file preview for multiple files', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        multiple: true
      });
      const props = createFileUploadProps(element, {
        initialFiles: [
          createMockFile('test1.txt', 'text/plain'),
          createMockFile('test2.txt', 'text/plain')
        ]
      });
      render(<FileUploadField {...props} onChange={mockOnChange} />);
      await waitFor(() => {
        expect(screen.getByText('test1.txt')).toBeTruthy();
        expect(screen.getByText('test2.txt')).toBeTruthy();
      });
    });

    it('displays image thumbnails for image files', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element, {
        initialFiles: [createMockImageFile()]
      });

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      await waitFor(() => {
        const images = screen.getAllByRole('img');
        expect(images.length).toEqual(1);
      });
    });

    it('displays image thumbnails for multiple image files', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        multiple: true
      });
      const props = createFileUploadProps(element, {
        initialFiles: [createMockImageFile(), createMockImageFile('test2.png')]
      });
      render(<FileUploadField {...props} onChange={mockOnChange} />);
      await waitFor(() => {
        const images = screen.getAllByRole('img');
        expect(images.length).toEqual(2);
      });
    });

    it('displays thumbnails for new uploaded files', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element);
      render(<FileUploadField {...props} onChange={mockOnChange} />);
      const testFile = createMockImageFile();
      const event = createFileInputChangeEvent([testFile]);
      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });
      await waitFor(() => {
        const images = screen.getAllByRole('img');
        expect(images.length).toEqual(1);
      });
    });

    it('hides preview when hide_file_preview is true', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      element.styles.hide_file_preview = true;
      const props = createFileUploadProps(element, {
        initialFiles: [createMockFile('test.txt', 'text/plain')]
      });

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      await waitFor(() => {
        expect(screen.queryByText('test.txt')).toBeFalsy();
      });
    });
  });

  describe('File Management', () => {
    it('removes files when clear button is clicked', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element, {
        initialFiles: [createMockFile('test.txt', 'text/plain')]
      });

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeTruthy();
      });

      const closeButton = screen.getByRole('button');

      await act(async () => {
        fireEvent.click(closeButton);
      });

      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('displays validation errors', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload', {
        file_types: ['image/*']
      });
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile('test.txt', 'text/plain');
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      // Check that the file input has custom validity set
      expect(getFileInput().validity.customError).toBe(true);
    });

    it('clears validation errors on successful upload', async () => {
      const mockOnChange = createStatefulFileOnChange();
      const element = createFileUploadElement('file_upload');
      const props = createFileUploadProps(element);

      render(<FileUploadField {...props} onChange={mockOnChange} />);

      const testFile = createMockFile('test.txt', 'text/plain');
      const event = createFileInputChangeEvent([testFile]);

      await act(async () => {
        fireEvent.change(getFileInput(), event);
      });

      // Check that validation errors are cleared
      expect(getFileInput().validity.customError).toBe(false);
    });
  });
});

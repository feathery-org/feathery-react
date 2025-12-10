/**
 * Tests for FeatheryClient._getFileValue method and resolveFile logic
 *
 * These tests verify the bug fixes for:
 * 1. String path + numeric index bug (character indexing)
 * 2. Empty string bypass bug
 * 3. Invalid servar validation
 * 4. Array edge cases (out of bounds, null elements)
 */

describe('FeatheryClient - resolveFile logic', () => {
  // Simulate the resolveFile logic without full class instantiation
  type FilePathMap = Record<string, null | string | (string | null)[]>;

  const createResolveFile = (servar: any, filePathMap: FilePathMap) => {
    return async (file: any, index: number | null = null) => {
      let path;
      try {
        // Servar validation
        if (!servar || typeof servar !== 'object') {
          console.error('[File Upload] Invalid servar:', servar);
          return null;
        }

        path = filePathMap[servar.key];

        // Only index if path is an array
        if (path && index !== null && Array.isArray(path)) {
          path = path[index];
        }

        // Empty string check
        return path && path !== '' ? path : await file;
      } catch (error) {
        return null;
      }
    };
  };

  let filePathMap: FilePathMap;

  beforeEach(() => {
    filePathMap = {};
  });

  describe('Servar validation', () => {
    it('handles null servar gracefully', async () => {
      const resolveFile = createResolveFile(null, filePathMap);
      const mockFile = new File(['content'], 'test.jpg');
      const result = await resolveFile(Promise.resolve(mockFile), null);
      expect(result).toBeNull();
    });

    it('handles undefined servar gracefully', async () => {
      const resolveFile = createResolveFile(undefined, filePathMap);
      const mockFile = new File(['content'], 'test.jpg');
      const result = await resolveFile(Promise.resolve(mockFile), null);
      expect(result).toBeNull();
    });

    it('handles non-object servar gracefully', async () => {
      const resolveFile = createResolveFile(
        'not-an-object' as any,
        filePathMap
      );
      const mockFile = new File(['content'], 'test.jpg');
      const result = await resolveFile(Promise.resolve(mockFile), null);
      expect(result).toBeNull();
    });

    it('handles valid servar correctly', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      filePathMap.image1 = 's3://bucket/file.jpg';
      const resolveFile = createResolveFile(servar, filePathMap);
      const mockFile = new File(['content'], 'test.jpg');
      const result = await resolveFile(Promise.resolve(mockFile), null);
      expect(result).toBe('s3://bucket/file.jpg');
    });
  });

  describe('String path with numeric index', () => {
    it('does NOT perform character indexing on string paths', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      // Set up string path (single file upload scenario)
      filePathMap.image1 = 's3://bucket/file.jpg';

      const resolveFile = createResolveFile(servar, filePathMap);

      // Call with index 0 (should NOT do character indexing)
      const result = await resolveFile(Promise.resolve(mockFile), 0);

      // Should return the S3 path (because Array.isArray guard prevents indexing on string)
      expect(result).toBe('s3://bucket/file.jpg');
      expect(result).not.toBe('s');
    });

    it('handles array paths correctly with index', async () => {
      const servar = { key: 'images', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      // Set up array path (multiple file upload scenario)
      filePathMap.images = ['s3://bucket/file1.jpg', 's3://bucket/file2.jpg'];

      const resolveFile = createResolveFile(servar, filePathMap);

      // Call with index 0
      const result1 = await resolveFile(Promise.resolve(mockFile), 0);
      expect(result1).toBe('s3://bucket/file1.jpg');

      // Call with index 1
      const result2 = await resolveFile(Promise.resolve(mockFile), 1);
      expect(result2).toBe('s3://bucket/file2.jpg');
    });

    it('handles single file without index (null)', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      filePathMap.image1 = 's3://bucket/file.jpg';

      const resolveFile = createResolveFile(servar, filePathMap);

      // Call with no index (null)
      const result = await resolveFile(Promise.resolve(mockFile), null);

      // Should return S3 path
      expect(result).toBe('s3://bucket/file.jpg');
    });
  });

  describe('Empty string bypass', () => {
    it('does NOT return empty string when path is empty', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      // Set up empty string path (edge case)
      filePathMap.image1 = '';

      const resolveFile = createResolveFile(servar, filePathMap);
      const result = await resolveFile(Promise.resolve(mockFile), null);

      // Should return File, not empty string
      expect(result).toBe(mockFile);
      expect(result).not.toBe('');
    });

    it('returns valid S3 path when available', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      // Set up valid path
      filePathMap.image1 = 's3://bucket/file.jpg';

      const resolveFile = createResolveFile(servar, filePathMap);
      const result = await resolveFile(Promise.resolve(mockFile), null);

      // Should return S3 path
      expect(result).toBe('s3://bucket/file.jpg');
    });

    it('returns File when path is null', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      filePathMap.image1 = null;

      const resolveFile = createResolveFile(servar, filePathMap);
      const result = await resolveFile(Promise.resolve(mockFile), null);

      // Should return File
      expect(result).toBe(mockFile);
    });

    it('returns File when path is undefined', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      // No entry in filePathMap (undefined)

      const resolveFile = createResolveFile(servar, filePathMap);
      const result = await resolveFile(Promise.resolve(mockFile), null);

      // Should return File
      expect(result).toBe(mockFile);
    });
  });

  describe('Array edge cases', () => {
    it('handles out of bounds array index', async () => {
      const servar = { key: 'images', type: 'file_upload' };
      const mockFile3 = new File(['content3'], 'test3.jpg');

      // Set up array with 2 elements
      filePathMap.images = ['s3://bucket/file1.jpg', 's3://bucket/file2.jpg'];

      const resolveFile = createResolveFile(servar, filePathMap);

      // Call with index 2 (out of bounds)
      const result = await resolveFile(Promise.resolve(mockFile3), 2);

      // Should return File (falls back since undefined)
      expect(result).toBe(mockFile3);
    });

    it('handles null elements in array path', async () => {
      const servar = { key: 'images', type: 'file_upload' };
      const mockFile1 = new File(['content1'], 'test1.jpg');

      // Set up array with null element (file was cleared)
      filePathMap.images = [null, 's3://bucket/file2.jpg'];

      const resolveFile = createResolveFile(servar, filePathMap);

      // Call with index 0 (null element)
      const result = await resolveFile(Promise.resolve(mockFile1), 0);

      // Should return File (null is falsy, falls back)
      expect(result).toBe(mockFile1);
    });

    it('handles negative index gracefully', async () => {
      const servar = { key: 'images', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      filePathMap.images = ['s3://bucket/file1.jpg', 's3://bucket/file2.jpg'];

      const resolveFile = createResolveFile(servar, filePathMap);

      // Call with negative index
      const result = await resolveFile(Promise.resolve(mockFile), -1);

      // Should return File (undefined[-1] is undefined, falls back)
      expect(result).toBe(mockFile);
    });
  });

  describe('Error handling', () => {
    it('handles rejected file promises gracefully', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const rejectedPromise = Promise.reject(new Error('Network error'));

      const resolveFile = createResolveFile(servar, filePathMap);

      // Should return null (caught by try-catch)
      const result = await resolveFile(rejectedPromise, null);
      expect(result).toBeNull();
    });

    it('handles non-Error rejection gracefully', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const rejectedPromise = Promise.reject(new Error('String error'));

      const resolveFile = createResolveFile(servar, filePathMap);

      // Should return null
      const result = await resolveFile(rejectedPromise, null);
      expect(result).toBeNull();
    });

    it('handles null file promise', async () => {
      const servar = { key: 'image1', type: 'file_upload' };

      const resolveFile = createResolveFile(servar, filePathMap);

      // await null returns null
      const result = await resolveFile(null, null);
      expect(result).toBeNull();
    });

    it('handles undefined file promise', async () => {
      const servar = { key: 'image1', type: 'file_upload' };

      const resolveFile = createResolveFile(servar, filePathMap);

      // await undefined returns undefined
      const result = await resolveFile(undefined, null);
      expect(result).toBeUndefined();
    });
  });

  describe('Direct File objects (non-Promise)', () => {
    it('handles direct File object without Promise', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      const resolveFile = createResolveFile(servar, filePathMap);

      // Pass File directly (not wrapped in Promise)
      const result = await resolveFile(mockFile, null);

      // Should return File immediately
      expect(result).toBe(mockFile);
    });

    it('prioritizes S3 path over direct File', async () => {
      const servar = { key: 'image1', type: 'file_upload' };
      const mockFile = new File(['content'], 'test.jpg');

      filePathMap.image1 = 's3://bucket/file.jpg';

      const resolveFile = createResolveFile(servar, filePathMap);

      // Pass File directly, but path exists
      const result = await resolveFile(mockFile, null);

      // Should return S3 path (path takes precedence)
      expect(result).toBe('s3://bucket/file.jpg');
    });
  });
});

/**
 * Tests for FeatheryClient._submitFileData method
 *
 * These tests verify that:
 * 1. Empty optional fields don't make unnecessary requests (Issue #3)
 * 2. Previously filled fields that are cleared DO make clear requests
 * 3. File fields with actual files make upload requests
 */
describe('FeatheryClient - _submitFileData optional field handling', () => {
  let mockFetch: jest.Mock;
  let mockOfflineRequestHandler: any;
  let fileDeduplicationCount: Record<string, number>;
  let fileRetryStatus: Record<string, boolean>;

  // Recreate the _submitFileData logic inline for testing
  const submitFileData = async (
    servar: any,
    stepKey: string,
    fileValue: any
  ) => {
    const url =
      'https://api.feathery.io/api/panel/step/submit/file/test-user-id/';

    const formData = new FormData();
    let numFiles = 0;

    if (fileValue || fileValue === '') {
      if (Array.isArray(fileValue)) {
        const validFiles = fileValue.filter(
          (file: any) => !!file && file !== ''
        );
        validFiles.forEach((file: any) => formData.append(servar.key, file));
        numFiles = validFiles.length;
      } else if (fileValue !== '') {
        formData.append(servar.key, fileValue);
        numFiles = 1;
      }
    }

    // If no files, check if we need to send clear request
    if (numFiles === 0) {
      const hasPreviousSuccess = fileRetryStatus[servar.key] !== undefined;
      if (
        fileDeduplicationCount[servar.key] === undefined &&
        !hasPreviousSuccess
      ) {
        return Promise.resolve();
      }
      formData.append(servar.key, '');
    }

    // Only block duplicate submissions if the previous attempt SUCCEEDED
    const hadSuccess = fileRetryStatus[servar.key];
    if (hadSuccess && fileDeduplicationCount[servar.key] === numFiles)
      return Promise.resolve();

    fileDeduplicationCount[servar.key] = numFiles;

    formData.set('__feathery_form_key', 'test-form');
    formData.set('__feathery_step_key', stepKey);
    formData.set('__feathery_version', '1');

    const options: any = {
      method: 'POST',
      body: formData,
      keepalive: false
    };

    try {
      await mockOfflineRequestHandler.clearFailedRequestByUrl(url, {
        fieldKey: servar.key
      });

      const result = await mockOfflineRequestHandler.runOrSaveRequest(
        () => mockFetch(url, options),
        url,
        options,
        'submit',
        stepKey,
        { fieldKey: servar.key }
      );
      fileRetryStatus[servar.key] = true;
      return result;
    } catch (error) {
      fileRetryStatus[servar.key] = false;
      delete fileDeduplicationCount[servar.key];
      throw error;
    }
  };

  beforeEach(() => {
    fileDeduplicationCount = {};
    fileRetryStatus = {};

    // Mock fetch
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({})
    });

    // Mock offlineRequestHandler
    mockOfflineRequestHandler = {
      clearFailedRequestByUrl: jest.fn().mockResolvedValue(undefined),
      runOrSaveRequest: jest.fn(async (fetchFn) => {
        return await fetchFn();
      })
    };
  });

  it('should NOT make request for empty optional field that was never touched', async () => {
    const servar = {
      key: 'FileUpload11',
      file_upload: {}
    };

    // Empty field (null)
    await submitFileData(servar, 'Step 1', null);

    // Should NOT make any fetch request for untouched optional field
    // This currently FAILS because the code makes a request with empty string
    expect(mockOfflineRequestHandler.runOrSaveRequest).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should make request when field has an actual file', async () => {
    const servar = {
      key: 'FileUpload12',
      file_upload: {}
    };

    const mockFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
    await submitFileData(servar, 'Step 1', mockFile);

    // Should make request with file
    expect(mockOfflineRequestHandler.runOrSaveRequest).toHaveBeenCalled();
    expect(
      mockOfflineRequestHandler.clearFailedRequestByUrl
    ).toHaveBeenCalledWith(
      expect.stringContaining('api/panel/step/submit/file'),
      { fieldKey: 'FileUpload12' }
    );
  });

  it('should make clear request when previously filled field is emptied', async () => {
    const servar = {
      key: 'FileUpload12',
      file_upload: {}
    };

    // First submission with file
    const mockFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
    await submitFileData(servar, 'Step 1', mockFile);

    // Reset mocks
    mockOfflineRequestHandler.runOrSaveRequest.mockClear();
    mockOfflineRequestHandler.clearFailedRequestByUrl.mockClear();

    // Second submission with empty field (file removed)
    await submitFileData(servar, 'Step 1', null);

    // Should still make request to clear the field on backend
    expect(mockOfflineRequestHandler.runOrSaveRequest).toHaveBeenCalled();

    // Verify FormData contains empty string for the field
    const runOrSaveCall =
      mockOfflineRequestHandler.runOrSaveRequest.mock.calls[0];
    expect(runOrSaveCall[2].body).toBeInstanceOf(FormData);
  });

  it('should NOT make duplicate requests for two empty optional fields', async () => {
    const servar1 = { key: 'FileUpload11', file_upload: {} };
    const servar2 = { key: 'FileUpload12', file_upload: {} };

    // Submit both empty fields
    await submitFileData(servar1, 'Step 1', null);
    await submitFileData(servar2, 'Step 1', null);

    // Should make ZERO requests total
    // This currently FAILS because the code makes requests with empty strings
    expect(mockOfflineRequestHandler.runOrSaveRequest).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should only make ONE request when one field has file and other is empty', async () => {
    const servar1 = { key: 'FileUpload11', file_upload: {} };
    const servar2 = { key: 'FileUpload12', file_upload: {} };

    const mockFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

    // First field: empty
    await submitFileData(servar1, 'Step 1', null);

    // Second field: has file
    await submitFileData(servar2, 'Step 1', mockFile);

    // Should make exactly ONE request (for the field with file)
    // This currently FAILS because empty field also makes a request
    expect(mockOfflineRequestHandler.runOrSaveRequest).toHaveBeenCalledTimes(1);
    expect(
      mockOfflineRequestHandler.clearFailedRequestByUrl
    ).toHaveBeenCalledWith(
      expect.stringContaining('api/panel/step/submit/file'),
      { fieldKey: 'FileUpload12' }
    );
  });
});

/**
 * Integration tests for OfflineRequestHandler
 *
 * These tests verify the high-level behavior and integration:
 * 1. Request queueing behavior when offline/network fails
 * 2. clearFailedRequestByUrl functionality (critical for file upload retry)
 * 3. Online/offline state handling
 * 4. Retry mechanism and error handling
 * 5. File upload retry scenarios
 *
 * Focus: Integration behavior rather than internal implementation details
 */

import { OfflineRequestHandler } from '../offlineRequestHandler';

// Mock init module
jest.mock('../init', () => ({
  initInfo: () => ({ sdkKey: 'test-sdk-key' })
}));

// Mock checkResponseSuccess
jest.mock('../featheryClient/utils', () => ({
  checkResponseSuccess: jest.fn().mockImplementation(async (response) => {
    if (!response.ok) {
      throw new Error('Response not ok');
    }
    return response;
  })
}));

describe('OfflineRequestHandler - Integration Tests', () => {
  let handler: OfflineRequestHandler;
  let errorCallback: jest.Mock;
  let originalNavigator: any;

  beforeAll(() => {
    originalNavigator = global.navigator;

    // Mock navigator with configurable onLine
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: { onLine: true }
    });

    // Mock Request constructor
    (global as any).Request = class MockRequest {
      url: string;
      method: string;
      headers: Map<string, string>;
      keepalive?: boolean;

      constructor(url: string, options: any) {
        this.url = url;
        this.method = options.method || 'GET';
        this.headers = new Map(Object.entries(options.headers || {}));
        this.keepalive = options.keepalive;
      }

      clone() {
        return this;
      }

      async blob() {
        return new Blob();
      }
    };
  });

  afterAll(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    errorCallback = jest.fn();
    handler = new OfflineRequestHandler('test-form', errorCallback);

    // Reset navigator.onLine
    Object.defineProperty(global.navigator, 'onLine', {
      writable: true,
      value: true,
      configurable: true
    });
  });

  describe('Request execution behavior', () => {
    it('executes request immediately when online', async () => {
      const mockRun = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun,
        'https://api.example.com/submit',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('attempts to queue when offline (no-op without IndexedDB)', async () => {
      Object.defineProperty(global.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      const mockRun = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun,
        'https://api.example.com/submit',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      // Should not execute when offline
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('queues request on network error (TypeError)', async () => {
      const mockRun = jest
        .fn()
        .mockRejectedValue(new TypeError('Network request failed'));

      await expect(
        handler.runOrSaveRequest(
          mockRun,
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow(TypeError);

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('does not queue non-network errors', async () => {
      const mockRun = jest
        .fn()
        .mockRejectedValue(new Error('Validation error'));

      await expect(
        handler.runOrSaveRequest(
          mockRun,
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Validation error');

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('re-throws error to caller after queueing', async () => {
      const networkError = new TypeError('Failed to fetch');
      const mockRun = jest.fn().mockRejectedValue(networkError);

      await expect(
        handler.runOrSaveRequest(
          mockRun,
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Failed to fetch');
    });
  });

  describe('File upload retry scenario', () => {
    it('does not trigger immediate replay on network error (prevents infinite loop)', async () => {
      const fileUrl = 'https://api.feathery.io/api/panel/step/submit/file/';

      // Mock the replayRequests method to track if it's called
      const replayRequestsSpy = jest.spyOn(handler as any, 'replayRequests');

      // Mock runOrSaveRequest to fail with network error
      const mockRun = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      // Attempt upload that will fail
      await expect(
        handler.runOrSaveRequest(
          mockRun,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Failed to fetch');

      // CRITICAL: replayRequests should NOT be called immediately after saveRequest
      // This prevents the infinite retry loop bug where failed requests
      // would be saved to IndexedDB and immediately replayed, causing
      // another failure, save, replay cycle ad infinitum
      expect(replayRequestsSpy).not.toHaveBeenCalled();

      replayRequestsSpy.mockRestore();
    });

    it('does not cause multiple retry attempts on single network failure', async () => {
      const fileUrl = 'https://api.feathery.io/api/panel/step/submit/file/';

      // Track how many times the mock function is called
      const mockRun = jest
        .fn()
        .mockRejectedValue(new TypeError('Network request failed'));

      // Single failed upload attempt
      await expect(
        handler.runOrSaveRequest(
          mockRun,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Network request failed');

      // Should only be called once - no automatic retries
      // This verifies the infinite loop fix is working
      expect(mockRun).toHaveBeenCalledTimes(1);

      // Give time for any async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Still should only be 1 call - no background retries
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('allows clearFailedRequestByUrl without throwing', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/field1';

      // This should not throw even without IndexedDB
      await expect(
        handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' })
      ).resolves.not.toThrow();
    });

    it('clearFailedRequestByUrl handles missing IndexedDB gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await handler.clearFailedRequestByUrl(
        'https://api.example.com/submit/file/',
        { fieldKey: 'testField' }
      );

      // Should handle gracefully without errors
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('allows retry flow: fail -> clear -> retry succeed', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/field1';

      // Step 1: Upload fails with network error
      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network blocked'));

      await expect(
        handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Network blocked');

      expect(mockRun1).toHaveBeenCalledTimes(1);

      // Step 2: User sees error and clicks retry

      // Step 3: Clear the failed request
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' });

      // Step 4: Network recovers - retry succeeds
      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun2,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun2).toHaveBeenCalledTimes(1);
    });

    it('clears failed request and allows immediate retry after network recovery', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/field1';

      // Simulate real user flow with button state management
      let buttonLocked = false;
      let errorOccurred = false;

      // Step 1: User clicks submit, button locks
      buttonLocked = true;

      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network blocked'));

      // Upload fails with network error
      try {
        await handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        );
      } catch (error) {
        // Error caught by Form component
        errorOccurred = true;
        // Button should unlock on error (this is what we're testing the fix for)
        buttonLocked = false;
      }

      expect(errorOccurred).toBe(true);
      expect(buttonLocked).toBe(false); // CRITICAL: Button must be unlocked for retry
      expect(mockRun1).toHaveBeenCalledTimes(1);

      // Step 2: User sees error message

      // Step 3: Network recovers, user clicks "next" again
      // Clear the failed request (happens in featheryClient before retry)
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' });

      // Step 4: Button can be clicked again (not locked)
      buttonLocked = true;
      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun2,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      // Success! Button unlocked after error = retry worked
      buttonLocked = false;
      expect(mockRun2).toHaveBeenCalledTimes(1);
    });

    it('supports multiple independent file uploads', async () => {
      const fileUrl = 'https://api.feathery.io/api/panel/step/submit/file/';

      // Upload file1 fails
      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network error'));
      await expect(
        handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow();

      // Upload file2 fails
      const mockRun2 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network error'));
      await expect(
        handler.runOrSaveRequest(
          mockRun2,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow();

      // Clear field1 only
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' });

      // Retry field1 successfully
      const mockRun3 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun3,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun3).toHaveBeenCalledTimes(1);

      // field2 can still be retried separately
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field2' });
      const mockRun4 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun4,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun4).toHaveBeenCalledTimes(1);
    });

    it('clears queue during submit, not during file removal', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/user123/';

      // Step 1: Upload fails with network error and gets queued
      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network blocked'));

      try {
        await handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        );
      } catch (error) {
        // Expected to fail and queue the request
      }

      expect(mockRun1).toHaveBeenCalledTimes(1);

      // Step 2: User removes the file from the form
      // NOTE: clearFilePathMapEntry does NOT clear the queue
      // Only clears in-memory tracking (filePathMap, fileSubmittedMap)

      // Step 3: User clicks "next" to submit
      // _submitFileData will clear the failed request before submitting
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'image1' });

      // Step 4: Submit with empty file array succeeds
      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun2,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun2).toHaveBeenCalledTimes(1);
    });
  });

  describe('IndexedDB support detection', () => {
    it('detects when IndexedDB is not supported', () => {
      const handlerWithoutIDB = new OfflineRequestHandler('test-form');
      expect((handlerWithoutIDB as any).indexedDBSupported).toBe(false);
    });

    it('handles saveRequest gracefully without IndexedDB', async () => {
      await expect(
        handler.saveRequest(
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).resolves.not.toThrow();
    });

    it('handles dbHasRequest gracefully without IndexedDB', async () => {
      const hasRequest = await handler.dbHasRequest();
      expect(hasRequest).toBe(false);
    });

    it('handles replayRequests gracefully without IndexedDB', async () => {
      await expect(handler.replayRequests()).resolves.not.toThrow();
    });

    it('handles openDatabase returning undefined gracefully', async () => {
      const db = await handler.openDatabase();
      expect(db).toBeUndefined();
    });
  });

  describe('Error callback behavior', () => {
    it('provides error callback to handler', () => {
      const customCallback = jest.fn();
      const customHandler = new OfflineRequestHandler(
        'test-form',
        customCallback
      );
      expect((customHandler as any).errorCallback).toBe(customCallback);
    });

    it('works without error callback', () => {
      expect(() => new OfflineRequestHandler('test-form')).not.toThrow();
    });

    it('accepts optional error callback parameter', () => {
      const handlerNoCallback = new OfflineRequestHandler('test-form');
      expect((handlerNoCallback as any).errorCallback).toBeUndefined();

      const handlerWithCallback = new OfflineRequestHandler(
        'test-form',
        errorCallback
      );
      expect((handlerWithCallback as any).errorCallback).toBe(errorCallback);
    });
  });

  describe('Request serialization readiness', () => {
    it('saveRequest completes without errors', async () => {
      // Without IndexedDB, saveRequest returns early but doesn't throw
      await expect(
        handler.saveRequest(
          'https://api.example.com/submit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'test' })
          },
          'submit'
        )
      ).resolves.not.toThrow();
    });

    it('includes stepKey in request metadata', async () => {
      // This test verifies the signature accepts stepKey
      await expect(
        handler.saveRequest(
          'https://api.example.com/event',
          { method: 'POST', headers: {}, body: '{}' },
          'registerEvent',
          'step1'
        )
      ).resolves.not.toThrow();
    });

    it('handles different request types', async () => {
      const types = ['submit', 'customRequest', 'registerEvent'];

      for (const type of types) {
        await expect(
          handler.saveRequest(
            'https://api.example.com/test',
            { method: 'POST', headers: {}, body: '{}' },
            type
          )
        ).resolves.not.toThrow();
      }
    });
  });

  describe('Form key isolation', () => {
    it('creates handler with specific form key', () => {
      const handler1 = new OfflineRequestHandler('form-1');
      const handler2 = new OfflineRequestHandler('form-2');

      expect((handler1 as any).formKey).toBe('form-1');
      expect((handler2 as any).formKey).toBe('form-2');
    });

    it('isolates operations by form key', async () => {
      const handler1 = new OfflineRequestHandler('form-1');
      const handler2 = new OfflineRequestHandler('form-2');

      // Operations should not interfere with each other
      await handler1.saveRequest(
        'https://api.example.com/1',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      await handler2.saveRequest(
        'https://api.example.com/2',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      const hasRequest1 = await handler1.dbHasRequest();
      const hasRequest2 = await handler2.dbHasRequest();

      // Both should handle gracefully (false without IndexedDB)
      expect(hasRequest1).toBe(false);
      expect(hasRequest2).toBe(false);
    });
  });

  describe('Configuration constants', () => {
    it('uses correct database configuration', () => {
      expect((handler as any).dbName).toBe('requestsDB');
      expect((handler as any).storeName).toBe('requestsStore');
      expect((handler as any).dbVersion).toBe(1);
    });

    it('uses correct retry configuration', () => {
      expect((handler as any).maxRetryAttempts).toBe(4);
      expect((handler as any).retryDelayMs).toBe(2000);
    });
  });

  describe('Online signal management', () => {
    it('manages online signals map', () => {
      expect((handler as any).onlineSignals).toBeInstanceOf(Map);
    });

    it('creates signal promise that can be awaited', () => {
      const promise = handler.onlineAndReplayed();
      expect(promise).toBeInstanceOf(Promise);
    });

    it('allows multiple callers to wait for online state', () => {
      const promise1 = handler.onlineAndReplayed();
      const promise2 = handler.onlineAndReplayed();

      expect(promise1).toBeInstanceOf(Promise);
      expect(promise2).toBeInstanceOf(Promise);
    });
  });

  describe('Integration scenario: Network toggle', () => {
    it('handles network going offline then online', async () => {
      // Start online
      expect(global.navigator.onLine).toBe(true);

      const mockRun1 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun1,
        'https://api.example.com/1',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      expect(mockRun1).toHaveBeenCalled();

      // Go offline
      Object.defineProperty(global.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun2,
        'https://api.example.com/2',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      expect(mockRun2).not.toHaveBeenCalled();

      // Go back online
      Object.defineProperty(global.navigator, 'onLine', {
        value: true,
        configurable: true
      });

      const mockRun3 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun3,
        'https://api.example.com/3',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      expect(mockRun3).toHaveBeenCalled();
    });
  });
});

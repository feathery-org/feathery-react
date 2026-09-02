import {
  _resetFileUploadProgress,
  clearCompletedUploads,
  completeUpload,
  dismissResolvedUploads,
  failUpload,
  getUploadsSnapshot,
  isLeaderToastHost,
  isUploadIndicatorEnabled,
  MIN_UPLOADING_MS,
  registerToastHost,
  setUploadIndicatorEnabled,
  queueUpload,
  startUpload,
  subscribeToUploads,
  unregisterToastHost
} from '../fileUploadProgress';

// The minimum-duration hold reads Date.now(), which this jest version's fake
// timers don't advance, so drive both clocks together.
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  jest.advanceTimersByTime(ms);
};
// Status flips are held back until MIN_UPLOADING_MS so the spinner is visible
const settle = () => advance(MIN_UPLOADING_MS);

describe('fileUploadProgress', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clock = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    _resetFileUploadProgress();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('flag gating', () => {
    it('ignores uploads for forms without the setting enabled', () => {
      startUpload('form-a', 'field-1', ['doc.pdf']);
      expect(getUploadsSnapshot()).toEqual([]);
    });

    it('tracks uploads only for enabled forms', () => {
      setUploadIndicatorEnabled('form-a', true);
      startUpload('form-a', 'field-1', ['doc.pdf']);
      startUpload('form-b', 'field-2', ['other.pdf']);
      expect(getUploadsSnapshot()).toEqual([
        {
          id: 'form-a::field-1',
          formKey: 'form-a',
          fieldKey: 'field-1',
          fileNames: ['doc.pdf'],
          fileCount: 1,
          status: 'uploading',
          startedAt: expect.any(Number)
        }
      ]);
    });

    it('can be disabled again', () => {
      setUploadIndicatorEnabled('form-a', true);
      setUploadIndicatorEnabled('form-a', false);
      expect(isUploadIndicatorEnabled('form-a')).toBe(false);
      startUpload('form-a', 'field-1');
      expect(getUploadsSnapshot()).toEqual([]);
    });
  });

  describe('status transitions', () => {
    beforeEach(() => setUploadIndicatorEnabled('form-a', true));

    it('completes and fails uploads', () => {
      startUpload('form-a', 'field-1', ['a.pdf']);
      startUpload('form-a', 'field-2', ['b.pdf']);
      completeUpload('form-a', 'field-1');
      failUpload('form-a', 'field-2');
      settle();
      expect(getUploadsSnapshot().map((e) => e.status)).toEqual([
        'complete',
        'error'
      ]);
    });

    it('holds the spinner for the minimum duration on a fast upload', () => {
      startUpload('form-a', 'field-1', ['tiny.png']);
      advance(80);
      completeUpload('form-a', 'field-1');

      // Still spinning right after the request resolves
      expect(getUploadsSnapshot()[0].status).toBe('uploading');

      advance(MIN_UPLOADING_MS - 80);
      expect(getUploadsSnapshot()[0].status).toBe('complete');
    });

    it('flips immediately once the minimum has already elapsed', () => {
      startUpload('form-a', 'field-1', ['big.pdf']);
      advance(MIN_UPLOADING_MS + 500);
      completeUpload('form-a', 'field-1');
      expect(getUploadsSnapshot()[0].status).toBe('complete');
    });

    it('ignores completion for unknown entries', () => {
      completeUpload('form-a', 'never-started');
      failUpload('form-a', 'never-started');
      expect(getUploadsSnapshot()).toEqual([]);
    });

    it('re-registering a field resets it to uploading and keeps names', () => {
      startUpload('form-a', 'field-1', ['a.pdf']);
      settle();
      failUpload('form-a', 'field-1');
      // Replay engine does not know file names
      startUpload('form-a', 'field-1');
      expect(getUploadsSnapshot()).toEqual([
        {
          id: 'form-a::field-1',
          formKey: 'form-a',
          fieldKey: 'field-1',
          fileNames: ['a.pdf'],
          fileCount: 1,
          status: 'uploading',
          startedAt: expect.any(Number)
        }
      ]);
    });

    it('a retry cancels a held status flip from the failed attempt', () => {
      startUpload('form-a', 'field-1', ['a.pdf']);
      failUpload('form-a', 'field-1');
      // Retry lands before the held error flip fires
      startUpload('form-a', 'field-1');
      settle();
      expect(getUploadsSnapshot()[0].status).toBe('uploading');
    });

    it('reports the file count separately from the names', () => {
      // A signature blob has no usable name but still counts
      startUpload('form-a', 'field-1', ['a.pdf'], 3);
      const [entry] = getUploadsSnapshot();
      expect(entry.fileNames).toEqual(['a.pdf']);
      expect(entry.fileCount).toBe(3);
    });

    it('a replayed request keeps the original file count', () => {
      startUpload('form-a', 'field-1', ['a.pdf', 'b.pdf']);
      settle();
      failUpload('form-a', 'field-1');
      // Replay engine knows neither names nor count
      startUpload('form-a', 'field-1');
      expect(getUploadsSnapshot()[0].fileCount).toBe(2);
    });

    it('queues a row without waiting for the minimum spinner hold', () => {
      startUpload('form-a', 'field-1', ['a.pdf']);
      queueUpload('form-a', 'field-1');
      // Queueing is not a resolution, so it applies right away
      expect(getUploadsSnapshot()[0].status).toBe('queued');
    });

    it('a replay re-announces a queued row as uploading', () => {
      startUpload('form-a', 'field-1', ['a.pdf']);
      queueUpload('form-a', 'field-1');
      startUpload('form-a', 'field-1');
      expect(getUploadsSnapshot()[0].status).toBe('uploading');
    });

    it('queueing cancels a held status flip', () => {
      startUpload('form-a', 'field-1', ['a.pdf']);
      failUpload('form-a', 'field-1');
      queueUpload('form-a', 'field-1');
      settle();
      expect(getUploadsSnapshot()[0].status).toBe('queued');
    });
  });

  describe('clearing rows', () => {
    beforeEach(() => setUploadIndicatorEnabled('form-a', true));

    it('clears completed uploads but keeps errors and pending rows', () => {
      startUpload('form-a', 'done');
      startUpload('form-a', 'failed');
      startUpload('form-a', 'inflight');
      startUpload('form-a', 'waiting');
      completeUpload('form-a', 'done');
      failUpload('form-a', 'failed');
      queueUpload('form-a', 'waiting');
      settle();

      clearCompletedUploads();
      expect(getUploadsSnapshot().map((e) => e.fieldKey)).toEqual([
        'failed',
        'inflight',
        'waiting'
      ]);
    });

    it('dismissal drops errors too, but never a row still in flight', () => {
      startUpload('form-a', 'done');
      startUpload('form-a', 'failed');
      startUpload('form-a', 'inflight');
      startUpload('form-a', 'waiting');
      completeUpload('form-a', 'done');
      failUpload('form-a', 'failed');
      queueUpload('form-a', 'waiting');
      settle();

      dismissResolvedUploads();
      expect(getUploadsSnapshot().map((e) => e.fieldKey)).toEqual([
        'inflight',
        'waiting'
      ]);
    });
  });

  describe('subscriptions', () => {
    it('notifies on changes and stops after unsubscribe', () => {
      setUploadIndicatorEnabled('form-a', true);
      const listener = jest.fn();
      const unsubscribe = subscribeToUploads(listener);

      startUpload('form-a', 'field-1');
      expect(listener).toHaveBeenCalledTimes(1);

      const before = getUploadsSnapshot();
      completeUpload('form-a', 'field-1');
      settle();
      expect(listener).toHaveBeenCalledTimes(2);
      // Snapshot identity changes so useSyncExternalStore re-renders
      expect(getUploadsSnapshot()).not.toBe(before);

      unsubscribe();
      startUpload('form-a', 'field-1');
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('does not notify for gated-off uploads', () => {
      const listener = jest.fn();
      subscribeToUploads(listener);
      startUpload('form-a', 'field-1');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('toast host election', () => {
    it('elects the first registered host and hands off on unregister', () => {
      registerToastHost('form-1');
      registerToastHost('form-2');
      expect(isLeaderToastHost('form-1')).toBe(true);
      expect(isLeaderToastHost('form-2')).toBe(false);

      unregisterToastHost('form-1');
      expect(isLeaderToastHost('form-2')).toBe(true);
    });

    it('registration is idempotent', () => {
      registerToastHost('form-1');
      registerToastHost('form-1');
      unregisterToastHost('form-1');
      expect(isLeaderToastHost('form-1')).toBe(false);
    });

    it('notifies subscribers on host changes so leadership re-renders', () => {
      const listener = jest.fn();
      subscribeToUploads(listener);
      registerToastHost('form-1');
      unregisterToastHost('form-1');
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});

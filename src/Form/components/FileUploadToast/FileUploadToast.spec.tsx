import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import FileUploadToast from './index';
import {
  _resetFileUploadProgress,
  completeUpload,
  getUploadToastHeight,
  MIN_UPLOADING_MS,
  setUploadIndicatorEnabled,
  startUpload
} from '../../../utils/fileUploadProgress';
import { featheryDoc } from '../../../utils/browser';

// jsdom has no ResizeObserver; report a fixed height so the box's contribution
// to the bottom-right stack is observable
const TOAST_HEIGHT = 84;
let observedNodes: Element[] = [];
(globalThis as any).ResizeObserver = jest
  .fn()
  .mockImplementation((onResize: ResizeObserverCallback) => ({
    observe: (node: Element) => {
      observedNodes.push(node);
      onResize(
        [{ contentRect: { height: TOAST_HEIGHT } } as ResizeObserverEntry],
        null as any
      );
    },
    unobserve: jest.fn(),
    disconnect: jest.fn()
  }));

// The minimum-duration hold reads Date.now(), which this jest version's fake
// timers don't advance, so drive both clocks together.
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  act(() => jest.advanceTimersByTime(ms));
};
// Lets the minimum-duration spinner hold expire so a finished upload can
// render its final state
const settle = () => advance(MIN_UPLOADING_MS);

describe('FileUploadToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clock = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    _resetFileUploadProgress();
    observedNodes = [];
    featheryDoc().getElementById('feathery-file-upload-toast')?.remove();
  });

  afterEach(() => {
    // Unmount before dropping the fake clock so the toast's pending auto-clear
    // timer can't survive into the next test
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders nothing when no uploads are tracked', () => {
    render(<FileUploadToast instanceId='form-1' bottom={20} />);
    expect(screen.queryByText('Uploading File')).toBeNull();
  });

  it('renders a single consolidated box across multiple form instances', () => {
    setUploadIndicatorEnabled('a', true);
    setUploadIndicatorEnabled('b', true);

    render(
      <>
        <FileUploadToast instanceId='form-1' bottom={20} />
        <FileUploadToast instanceId='form-2' bottom={20} />
      </>
    );
    act(() => {
      startUpload('a', 'field-1', ['resume.pdf']);
      startUpload('b', 'field-2', ['id.png']);
    });

    expect(screen.getAllByText('Uploading Files')).toHaveLength(1);
    expect(screen.getByText('resume.pdf')).toBeInTheDocument();
    expect(screen.getByText('id.png')).toBeInTheDocument();
  });

  it('falls back to the field key when file names are unknown', () => {
    setUploadIndicatorEnabled('a', true);
    render(<FileUploadToast instanceId='form-1' bottom={20} />);
    act(() => startUpload('a', 'signature-field'));
    expect(screen.getByText('signature-field')).toBeInTheDocument();
  });

  it('hands leadership to the remaining instance when the leader unmounts', () => {
    setUploadIndicatorEnabled('a', true);
    const { rerender } = render(
      <>
        <FileUploadToast instanceId='form-1' bottom={20} />
        <FileUploadToast instanceId='form-2' bottom={20} />
      </>
    );
    act(() => startUpload('a', 'field-1', ['resume.pdf']));

    rerender(<FileUploadToast instanceId='form-2' bottom={20} />);
    expect(screen.getAllByText('resume.pdf')).toHaveLength(1);
  });

  it('auto-clears after all uploads finish', () => {
    setUploadIndicatorEnabled('a', true);
    render(<FileUploadToast instanceId='form-1' bottom={20} />);
    act(() => startUpload('a', 'field-1', ['resume.pdf']));
    act(() => completeUpload('a', 'field-1'));
    settle();

    expect(screen.getByText('File Uploaded')).toBeInTheDocument();
    advance(3200);
    expect(screen.queryByText('File Uploaded')).toBeNull();
  });

  describe('height published for the bottom-right stack', () => {
    it('reports zero while no box is rendered', () => {
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      expect(getUploadToastHeight()).toEqual(0);
      expect(observedNodes).toHaveLength(0);
    });

    it('measures the box so overlays can clear it', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() => startUpload('a', 'field-1', ['resume.pdf']));

      expect(getUploadToastHeight()).toEqual(TOAST_HEIGHT);
      expect(observedNodes).toHaveLength(1);
    });

    it('reports zero again once the box clears', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() => startUpload('a', 'field-1', ['resume.pdf']));
      act(() => completeUpload('a', 'field-1'));
      settle();
      advance(3200);

      expect(getUploadToastHeight()).toEqual(0);
    });

    it('keeps reporting a height after leadership moves', () => {
      setUploadIndicatorEnabled('a', true);
      const { rerender } = render(
        <>
          <FileUploadToast instanceId='form-1' bottom={20} />
          <FileUploadToast instanceId='form-2' bottom={20} />
        </>
      );
      act(() => startUpload('a', 'field-1', ['resume.pdf']));

      rerender(<FileUploadToast instanceId='form-2' bottom={20} />);
      expect(getUploadToastHeight()).toEqual(TOAST_HEIGHT);
    });
  });

  describe('spinner while uploads are in flight', () => {
    const spinners = () =>
      featheryDoc().querySelectorAll(
        'circle[style*="feathery-spinner-rotate"]'
      );

    it('shows one bottom-right spinner for several images in one field', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() =>
        startUpload('a', 'photos', ['one.png', 'two.png', 'three.png'])
      );

      expect(spinners()).toHaveLength(1);
      expect(screen.getByText('one.png, two.png, three.png')).toBeVisible();

      const box = featheryDoc().getElementById('feathery-file-upload-toast')
        ?.firstElementChild as HTMLElement;
      const style = getComputedStyle(box);
      expect(style.position).toBe('fixed');
      expect(style.right).toBe('16px');
    });

    it('pluralizes the header on file count, not row count', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() => startUpload('a', 'photos', ['one.png', 'two.png']));

      expect(screen.getByText('Uploading Files')).toBeVisible();
      act(() => completeUpload('a', 'photos'));
      settle();
      expect(screen.getByText('Files Uploaded')).toBeVisible();
    });

    it('shows a spinner per field while several image fields upload', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() => {
        startUpload('a', 'front', ['front.jpg']);
        startUpload('a', 'back', ['back.jpg']);
      });

      expect(spinners()).toHaveLength(2);
    });

    it('keeps a spinner for the field still uploading after another finishes', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() => {
        startUpload('a', 'front', ['front.jpg']);
        startUpload('a', 'back', ['back.jpg']);
        completeUpload('a', 'front');
      });
      settle();

      expect(spinners()).toHaveLength(1);
      expect(screen.getByText('Uploading Files')).toBeVisible();
    });

    it('holds the spinner briefly even when the upload returns instantly', () => {
      setUploadIndicatorEnabled('a', true);
      render(<FileUploadToast instanceId='form-1' bottom={20} />);
      act(() => {
        startUpload('a', 'photos', ['tiny.png']);
        completeUpload('a', 'photos');
      });

      // The user still sees a spinner rather than an instant checkmark
      expect(spinners()).toHaveLength(1);
      settle();
      expect(spinners()).toHaveLength(0);
      expect(screen.getByText('File Uploaded')).toBeVisible();
    });
  });

  it('keeps the box up while any upload is still in flight', () => {
    setUploadIndicatorEnabled('a', true);
    render(<FileUploadToast instanceId='form-1' bottom={20} />);
    act(() => {
      startUpload('a', 'field-1', ['resume.pdf']);
      startUpload('a', 'field-2', ['id.png']);
      completeUpload('a', 'field-1');
    });

    advance(10000);
    expect(screen.getByText('Uploading Files')).toBeInTheDocument();
  });
});

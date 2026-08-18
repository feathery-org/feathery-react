import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AudioRecordingField from '../index';
import {
  createAudioRecordingElement,
  createAudioRecordingProps,
  installAudioMocks,
  resetMockFieldValue,
  MockMediaRecorder
} from './test-utils';

describe('AudioRecordingField', () => {
  let mocks: ReturnType<typeof installAudioMocks>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
    mocks = installAudioMocks();
  });

  const startRecording = async () => {
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Audio recording field' })
      );
    });
  };

  it('renders the record CTA when empty', () => {
    const element = createAudioRecordingElement();
    render(<AudioRecordingField {...createAudioRecordingProps(element)} />);

    expect(screen.getByText('Record audio')).toBeTruthy();
  });

  it('starts recording on click and shows the stop control', async () => {
    const element = createAudioRecordingElement();
    render(<AudioRecordingField {...createAudioRecordingProps(element)} />);

    await startRecording();

    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].start).toHaveBeenCalled();
    // Preferred supported mime type is selected
    expect(MockMediaRecorder.instances[0].mimeType).toBe(
      'audio/webm;codecs=opus'
    );
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();
  });

  it('produces an audio File on stop and clears it', async () => {
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { onChange })}
      />
    );

    await startRecording();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const file = await onChange.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('test-audio-key.webm');
    expect(file.type).toBe('audio/webm');
    expect(mocks.track.stop).toHaveBeenCalled();

    // Recorded state shows playback + clear
    await waitFor(() =>
      expect(screen.getByLabelText('Play recording')).toBeTruthy()
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Clear recording'));
    });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Record audio')).toBeTruthy();
  });

  it('prefers AAC/m4a when the browser can encode it', async () => {
    MockMediaRecorder.supportedTypes = [
      'audio/mp4;codecs=mp4a.40.2',
      'audio/webm'
    ];
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { onChange })}
      />
    );

    await startRecording();
    expect(MockMediaRecorder.instances[0].mimeType).toBe(
      'audio/mp4;codecs=mp4a.40.2'
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });

    const file = await onChange.mock.calls[0][0];
    expect(file.name).toBe('test-audio-key.m4a');
    expect(file.type).toBe('audio/mp4');
  });

  it('records via keyboard activation', async () => {
    const element = createAudioRecordingElement();
    render(<AudioRecordingField {...createAudioRecordingProps(element)} />);

    await act(async () => {
      fireEvent.keyDown(
        screen.getByRole('button', { name: 'Audio recording field' }),
        { key: 'Enter' }
      );
    });

    expect(mocks.getUserMedia).toHaveBeenCalled();
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();
  });

  it('reports an empty recording instead of storing it', async () => {
    MockMediaRecorder.emitEmpty = true;
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { onChange })}
      />
    );

    await startRecording();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Nothing was recorded. Please try again')).toBeTruthy();
  });

  it('releases the microphone when unmounted mid-recording', async () => {
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    const { unmount } = render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { onChange })}
      />
    );

    await startRecording();
    unmount();

    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalled();
    expect(mocks.track.stop).toHaveBeenCalled();
    // An in-flight recording is discarded rather than submitted
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops recording when the field becomes disabled', async () => {
    const element = createAudioRecordingElement();
    const props = createAudioRecordingProps(element);
    const { rerender } = render(<AudioRecordingField {...props} />);

    await startRecording();
    await act(async () => {
      rerender(<AudioRecordingField {...props} disabled />);
    });

    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalled();
    expect(mocks.track.stop).toHaveBeenCalled();
  });

  describe('recording is scoped to the field', () => {
    // Recording must end when attention moves elsewhere, but the audio
    // captured so far is kept rather than discarded
    const expectStoppedAndKept = async (onChange: jest.Mock) => {
      expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalled();
      expect(mocks.track.stop).toHaveBeenCalled();
      expect(await onChange.mock.calls[0][0]).toBeInstanceOf(File);
    };

    const renderRecording = async () => {
      const onChange = jest.fn();
      const element = createAudioRecordingElement();
      render(
        <AudioRecordingField
          {...createAudioRecordingProps(element, { onChange })}
        />
      );
      await startRecording();
      return onChange;
    };

    it('stops when another control is activated', async () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      const onChange = await renderRecording();

      await act(async () => {
        fireEvent.pointerDown(outside);
      });

      await expectStoppedAndKept(onChange);
      outside.remove();
    });

    it('keeps recording through a non-interactive tap, e.g. a scroll', async () => {
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      const onChange = await renderRecording();

      await act(async () => {
        fireEvent.pointerDown(outside);
      });

      expect(MockMediaRecorder.instances[0].stop).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      outside.remove();
    });

    it('stops when focus moves to another field', async () => {
      const outside = document.createElement('input');
      document.body.appendChild(outside);
      const onChange = await renderRecording();

      await act(async () => {
        fireEvent.focusIn(outside);
      });

      await expectStoppedAndKept(onChange);
      outside.remove();
    });

    it('stops when the tab is backgrounded', async () => {
      const onChange = await renderRecording();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden'
      });
      try {
        await act(async () => {
          fireEvent(document, new Event('visibilitychange'));
        });
        await expectStoppedAndKept(onChange);
      } finally {
        delete (document as any).visibilityState;
      }
    });
  });

  it('still records after a StrictMode-style mount/cleanup/mount', async () => {
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    const props = createAudioRecordingProps(element, { onChange });
    render(
      <React.StrictMode>
        <AudioRecordingField {...props} />
      </React.StrictMode>
    );

    await startRecording();
    // The unmount guard must be re-armed on remount, or this never starts
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    expect(await onChange.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it('shows an error message when microphone permission is denied', async () => {
    mocks.getUserMedia.mockRejectedValue(new Error('denied'));
    const element = createAudioRecordingElement();
    render(<AudioRecordingField {...createAudioRecordingProps(element)} />);

    await startRecording();

    expect(screen.getByText('Microphone access was denied')).toBeTruthy();
  });

  it('does not record when disabled or in edit mode', async () => {
    const element = createAudioRecordingElement();
    const { unmount } = render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { disabled: true })}
      />
    );
    await startRecording();
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    unmount();

    render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { editMode: 'editable' })}
      />
    );
    await startRecording();
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
  });

  it('renders playback for an initial file value', async () => {
    const element = createAudioRecordingElement();
    const file = new File(['audio-bytes'], 'existing.m4a', {
      type: 'audio/mp4'
    });
    const { container } = render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, {
          initialFile: Promise.resolve(file)
        })}
      />
    );

    await waitFor(() =>
      expect(container.querySelector('audio')).not.toBeNull()
    );
    expect(container.querySelector('audio')?.getAttribute('src')).toBe(
      'blob:mock-audio-url'
    );
    expect(screen.getByLabelText('Clear recording')).toBeTruthy();
  });

  it('offers playback but no clear control when read-only', async () => {
    const element = createAudioRecordingElement();
    const file = new File(['audio-bytes'], 'existing.m4a', {
      type: 'audio/mp4'
    });
    const { container } = render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, {
          disabled: true,
          initialFile: Promise.resolve(file)
        })}
      />
    );

    await waitFor(() =>
      expect(container.querySelector('audio')).not.toBeNull()
    );
    expect(screen.queryByLabelText('Clear recording')).toBeNull();
  });

  it('plays back through the themed player, not native controls', async () => {
    const element = createAudioRecordingElement();
    const file = new File(['audio-bytes'], 'existing.m4a', {
      type: 'audio/mp4'
    });
    const { container } = render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, {
          initialFile: Promise.resolve(file)
        })}
      />
    );

    const audio = await waitFor(() => {
      const el = container.querySelector('audio');
      expect(el).not.toBeNull();
      return el as HTMLAudioElement;
    });
    // Our own controls replace the unthemeable native ones
    expect(audio.hasAttribute('controls')).toBe(false);
    expect(screen.getByLabelText('Play recording')).toBeTruthy();

    const play = jest
      .spyOn(audio, 'play')
      .mockImplementation(() => Promise.resolve());
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      get: () => true
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Play recording'));
    });
    expect(play).toHaveBeenCalled();

    // The label flips once the element reports playing
    await act(async () => {
      fireEvent.play(audio);
    });
    expect(screen.getByLabelText('Pause recording')).toBeTruthy();
  });

  it('auto-stops at metadata.max_duration', async () => {
    jest.useFakeTimers();
    const startTime = 1000000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(startTime);
    try {
      const element = createAudioRecordingElement({ max_duration: 2 });
      render(<AudioRecordingField {...createAudioRecordingProps(element)} />);

      await startRecording();
      const recorder = MockMediaRecorder.instances[0];
      expect(recorder.stop).not.toHaveBeenCalled();

      nowSpy.mockReturnValue(startTime + 2500);
      await act(async () => {
        jest.advanceTimersByTime(2500);
      });
      expect(recorder.stop).toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});

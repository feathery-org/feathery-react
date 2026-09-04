import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor
} from '@testing-library/react';
import AudioRecordingField from '../index';
import { applyFieldStyles } from '../../index';
import ResponsiveStyles from '../../../styles';
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

  afterEach(() => jest.restoreAllMocks());

  // A take must clear MIN_TAKE_SECONDS to count, so move the clock on
  const advanceClock = (seconds: number) => {
    const base = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(base + seconds * 1000);
  };

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
    advanceClock(2);
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
    advanceClock(2);
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
    advanceClock(2);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('Nothing was recorded. Please try again')
    ).toBeTruthy();
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
      advanceClock(2);
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
    advanceClock(2);
    // The unmount guard must be re-armed on remount, or this never starts
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    expect(await onChange.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it('re-records after clearing, keeping the new take', async () => {
    // Mirrors a real form: the parent stores the value and feeds it back
    const element = createAudioRecordingElement();
    const emitted: any[] = [];
    function Host() {
      const [value, setValue] = React.useState<any>(null);
      return (
        <AudioRecordingField
          {...createAudioRecordingProps(element)}
          initialFile={value}
          onChange={(next: any) => {
            emitted.push(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Host />);

    await startRecording();
    advanceClock(2);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    const first = await emitted[0];

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Clear recording'));
    });
    expect(screen.getByText('Record audio')).toBeTruthy();

    await startRecording();
    advanceClock(2);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    const second = await emitted[emitted.length - 1];

    // The second take must be its own file, not the first one replayed
    expect(second).not.toBe(first);
    expect(second.size).toBeGreaterThan(first.size);
  });

  it('starts playback state fresh when the value swaps to another recording', async () => {
    // The field drops the old object URL before it assigns the next one, so
    // the player is torn down between takes rather than reused
    let urlCount = 0;
    (global.URL as any).createObjectURL = jest.fn(
      () => `blob:mock-audio-url-${++urlCount}`
    );
    const frames: FrameRequestCallback[] = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const element = createAudioRecordingElement();
    const first = Promise.resolve(new File(['first'], 'first.webm'));
    const second = Promise.resolve(new File(['second-take'], 'second.webm'));
    const Host = ({ file }: { file: any }) => (
      <AudioRecordingField
        {...createAudioRecordingProps(element, { initialFile: file })}
      />
    );
    const { container, rerender } = render(<Host file={first} />);
    await waitFor(() => screen.getByRole('button', { name: 'Play recording' }));

    const audio = container.querySelector('audio') as any;
    Object.defineProperty(audio, 'duration', { value: 10, configurable: true });
    Object.defineProperty(audio, 'currentTime', {
      value: 4,
      configurable: true
    });
    await act(async () => {
      fireEvent.durationChange(audio);
      fireEvent.play(audio);
      fireEvent.timeUpdate(audio);
    });
    await waitFor(() => screen.getByText('0:04 / 0:10'));
    expect(
      screen.getByRole('button', { name: 'Pause recording' })
    ).toBeTruthy();

    await act(async () => {
      rerender(<Host file={second} />);
    });
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        'blob:mock-audio-url-2'
      )
    );

    // The new take owns the readout: no borrowed duration, no borrowed progress
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play recording' })).toBeTruthy();
  });

  it('starts the readout fresh on the take that follows a re-record', async () => {
    const element = createAudioRecordingElement();
    const { container } = render(
      <AudioRecordingField {...createAudioRecordingProps(element)} />
    );

    await startRecording();
    advanceClock(2);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    await waitFor(() => screen.getByRole('button', { name: 'Play recording' }));

    // Drive the first take partway, so anything carried over would show
    const audio = container.querySelector('audio') as any;
    Object.defineProperty(audio, 'duration', { value: 10, configurable: true });
    Object.defineProperty(audio, 'currentTime', {
      value: 4,
      configurable: true
    });
    await act(async () => {
      fireEvent.durationChange(audio);
      fireEvent.timeUpdate(audio);
    });
    await waitFor(() => screen.getByText('0:04 / 0:10'));

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Clear recording'));
    });
    await startRecording();
    advanceClock(3);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    await waitFor(() => screen.getByRole('button', { name: 'Play recording' }));

    // The new take has reported nothing yet, so the readout falls back to the
    // length the recorder timed, not the previous take's numbers
    expect(screen.getByText('0:00 / 0:03')).toBeTruthy();
  });

  it('never seeks the element when the browser reports no duration', async () => {
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    const { container } = render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { onChange })}
      />
    );

    await startRecording();
    advanceClock(2);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });
    const audio = await waitFor(() => {
      const el = container.querySelector('audio');
      expect(el).not.toBeNull();
      return el as HTMLAudioElement;
    });

    // Seeking to discover the real duration parks playback at the end
    const seeks: number[] = [];
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      get: () => Infinity
    });
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: (value: number) => seeks.push(value)
    });
    await act(async () => {
      fireEvent.loadedMetadata(audio);
      fireEvent.durationChange(audio);
    });

    expect(seeks).toEqual([]);
    expect(screen.getByText(/0:0\d \/ 0:0\d/)).toBeTruthy();
  });

  it('uses a builder-set button text and icon', async () => {
    const element = createAudioRecordingElement();
    element.properties.placeholder = 'Leave a voice message';
    element.properties.icon = 'https://cdn.example.com/mic.png';
    const { container } = render(
      <AudioRecordingField {...createAudioRecordingProps(element)} />
    );

    expect(screen.getByText('Leave a voice message')).toBeTruthy();
    expect(screen.queryByText('Record audio')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/mic.png'
    );
  });

  it('discards a stray tap instead of banking a fractional-second take', async () => {
    const onChange = jest.fn();
    const element = createAudioRecordingElement();
    render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { onChange })}
      />
    );

    // Start and stop immediately, as a mis-click would
    await startRecording();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop recording'));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('Nothing was recorded. Please try again')
    ).toBeTruthy();
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

  describe('themed styles', () => {
    // The builder's Image and Recorder sections write these; applyFieldStyles
    // is what turns them into the targets the field reads
    const targetsFor = (styles: any) => {
      const field = createAudioRecordingElement();
      field.styles = styles;
      return applyFieldStyles(field, new ResponsiveStyles(field, [], false));
    };

    it('maps the image width and position onto the icon and its row', () => {
      const applied = targetsFor({
        image_width: 32,
        image_width_unit: 'px',
        flex_direction: 'column'
      });

      expect(applied.getTarget('img').width).toBe('32px');
      expect(applied.getTarget('ac').flexDirection).toBe('column');
    });

    it('maps bar_color onto the progress bar', () => {
      expect(targetsFor({ bar_color: '00FF00FF' }).getTarget('bar')).toEqual({
        backgroundColor: '#00FF00FF'
      });
    });

    it('leaves the bar unstyled when no color is set, so it follows the font', () => {
      expect(targetsFor({}).getTarget('bar').backgroundColor).toBeUndefined();
    });
  });

  it('advances the progress readout between timeupdate events', async () => {
    const frames: FrameRequestCallback[] = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const element = createAudioRecordingElement();
    const file = Promise.resolve(new File(['audio'], 'take.webm'));
    render(
      <AudioRecordingField
        {...createAudioRecordingProps(element, { initialFile: file })}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: 'Play recording' }));

    const audio = document.querySelector('audio') as any;
    Object.defineProperty(audio, 'duration', { value: 10, configurable: true });
    await act(async () => {
      fireEvent.durationChange(audio);
    });
    // Let the reported duration reach the readout first, so the assertion
    // below cannot straddle an effect that has yet to flush
    await waitFor(() => screen.getByText('0:00 / 0:10'));

    await act(async () => {
      fireEvent.play(audio);
    });

    // No timeupdate here: only the frame loop should move the readout
    audio.currentTime = 4;
    await act(async () => {
      frames.splice(0).forEach((frame) => frame(0));
    });

    await waitFor(() => screen.getByText('0:04 / 0:10'));
  });
});

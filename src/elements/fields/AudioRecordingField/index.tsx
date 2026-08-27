import React, { useEffect, useRef, useState } from 'react';
import { CloseIcon, MicrophoneIcon } from '../../components/icons';
import ErrorInput from '../../components/ErrorInput';
import { imgMaxSizeStyles } from '../../styles';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { AudioRecordingTranslations, defaultTranslations } from './translation';
import AudioPlayer from './AudioPlayer';
import LevelMeter from './LevelMeter';
import { formatDuration } from './format';
import { fieldAriaLabel } from '../shared/accessibleName';

// AAC (.m4a) plays everywhere so it leads; bare audio/mp4 trails the webm
// entries because Chrome may fill it with Opus, which .m4a players can't decode
const MIME_PREFERENCES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

const EXTENSION_MAP: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3'
};

const RECORDING_COLOR = '#E53935';

// Clips this short are stray taps, not speech; on a repeating field each one
// would also spawn a row
const MIN_TAKE_SECONDS = 0.4;

// Activating one of these ends a recording; scrolls and stray taps don't
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [tabindex]';

function AudioRecordingField({
  element,
  responsiveStyles,
  fieldLabel,
  disabled = false,
  editMode,
  onChange: customOnChange = () => {},
  initialFile = null,
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const maxDuration = servar.metadata.max_duration;

  const t = {
    ...defaultTranslations,
    ...(element.properties.translate as Partial<AudioRecordingTranslations>)
  };

  const [rawFile, setRawFile] = useState<any>(initialFile);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  // Chrome reports Infinity for a fresh recording, so time it ourselves
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [message, setMessage] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef(0);
  const audioCtxRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const levelBufferRef = useRef<Uint8Array | null>(null);
  // Guards double-starts while the mic permission prompt is open
  const startingRef = useRef(false);
  // Set on unmount so an in-flight recording is dropped instead of saved
  const discardRef = useRef(false);
  // Distinguishes our own echo from a value set from outside
  const emittedRef = useRef<any>(null);

  // Adopt external values; recording emits the promise it stores, so its
  // own echo is a no-op set
  useEffect(() => {
    setRawFile(initialFile ?? null);
    // Our echo carries the length we timed; anything else invalidates it
    if (initialFile !== emittedRef.current) setRecordedSeconds(0);
  }, [initialFile]);

  useEffect(() => {
    let cancelled = false;
    let url = '';
    // Drop the old URL up front; the cleanup below revokes it
    setPlaybackUrl('');
    if (!rawFile) return;
    Promise.resolve(rawFile)
      .then((file: any) => {
        if (cancelled || !file) return;
        url = URL.createObjectURL(file);
        setPlaybackUrl(url);
      })
      // A rehydrated file promise can reject (offline) — no playback then
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rawFile]);

  // Optional: browsers without AudioContext just get no waveform
  const setupMetering = (win: any, stream: any) => {
    const AudioContextClass = win.AudioContext || win.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const audioCtx = new AudioContextClass();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      levelBufferRef.current = new Uint8Array(analyser.fftSize);
    } catch {
      teardownMetering();
    }
  };

  const teardownMetering = () => {
    analyserRef.current = null;
    levelBufferRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => undefined);
  };

  const getLevel = () => {
    const analyser = analyserRef.current;
    const buffer = levelBufferRef.current;
    if (!analyser || !buffer) return 0;
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const deviation = (buffer[i] - 128) / 128;
      sum += deviation * deviation;
    }
    return Math.sqrt(sum / buffer.length);
  };

  useEffect(() => {
    // Re-arm on mount: StrictMode runs the cleanup below on a live component,
    // and a stuck flag would discard every later recording
    discardRef.current = false;
    return () => {
      discardRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      teardownMetering();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      // Recorder onstop stops the tracks; cover the recorder-less case too
      else streamRef.current?.getTracks().forEach((track: any) => track.stop());
    };
  }, []);

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    teardownMetering();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  // Disabling mid-recording also hides the stop control, so end it here
  useEffect(() => {
    if ((disabled || editMode) && recording) stopRecording();
  }, [disabled, editMode, recording]);

  // Recording is scoped to this field: focus leaving, another control being
  // activated, or the tab hiding ends it. Stopping keeps the audio so far.
  useEffect(() => {
    if (!recording) return;
    const doc = featheryDoc();
    const isOutside = (node: any) =>
      !!node && !containerRef.current?.contains(node);
    const onFocusIn = (event: any) => {
      // Focus falling back to the body isn't the respondent moving on
      const target = event.target;
      if (target === doc.body || target === doc.documentElement) return;
      if (isOutside(target)) stopRecording();
    };
    const onPointerDown = (event: any) => {
      const target = event.target;
      if (isOutside(target) && target?.closest?.(INTERACTIVE_SELECTOR))
        stopRecording();
    };
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'hidden') stopRecording();
    };
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [recording]);

  const startRecording = async () => {
    if (disabled || editMode || recording || startingRef.current) return;
    const win = featheryWindow();
    const MediaRecorderClass = win.MediaRecorder;
    if (!win.navigator?.mediaDevices?.getUserMedia || !MediaRecorderClass) {
      setMessage(t.unsupported);
      return;
    }

    startingRef.current = true;
    let stream: any;
    try {
      stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMessage(t.denied);
      return;
    } finally {
      startingRef.current = false;
    }
    // The user may have navigated away while the permission prompt was open
    if (discardRef.current) {
      stream.getTracks().forEach((track: any) => track.stop());
      return;
    }
    setMessage('');

    const preferred = MediaRecorderClass.isTypeSupported
      ? MIME_PREFERENCES.find((mimeType) =>
          MediaRecorderClass.isTypeSupported(mimeType)
        )
      : undefined;
    // isTypeSupported is advisory; fall back to the default encoding
    let recorder: any;
    try {
      recorder = preferred
        ? new MediaRecorderClass(stream, { mimeType: preferred })
        : new MediaRecorderClass(stream);
    } catch {
      try {
        recorder = new MediaRecorderClass(stream);
      } catch {
        stream.getTracks().forEach((track: any) => track.stop());
        setMessage(t.unsupported);
        return;
      }
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    setupMetering(win, stream);

    recorder.ondataavailable = (event: any) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track: any) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      teardownMetering();

      const mimeType = (recorder.mimeType || preferred || 'audio/webm').split(
        ';'
      )[0];
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (discardRef.current) return;
      const seconds = (Date.now() - startTimeRef.current) / 1000;
      if (blob.size === 0 || seconds < MIN_TAKE_SECONDS) {
        setMessage(t.empty);
        return;
      }

      const extension = EXTENSION_MAP[mimeType] ?? 'webm';
      const file = new File([blob], `${servar.key}.${extension}`, {
        type: mimeType
      });
      // Emit the promise we hold, so the echo through initialFile doesn't
      // churn the object URL behind the player
      const filePromise = Promise.resolve(file);
      emittedRef.current = filePromise;
      setRecordedSeconds(seconds);
      setRawFile(filePromise);
      customOnChange(filePromise);
    };

    recorder.start();
    startTimeRef.current = Date.now();
    setElapsed(0);
    setRecording(true);
    timerRef.current = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(elapsedSec);
      if (maxDuration && elapsedSec >= maxDuration) stopRecording();
    }, 250);
  };

  const clearRecording = (event: any) => {
    event.stopPropagation();
    setMessage('');
    setRawFile(null);
    customOnChange(null);
  };

  const themedAc: any = responsiveStyles.getTarget('ac') ?? {};
  // Stacked layouts put the icon on the main axis, where flex-shrink: 0 would
  // push the content past the field height instead of fitting it
  const stacked = String(themedAc.flexDirection ?? '').startsWith('column');
  const themedImg: any = responsiveStyles.getTarget('img') ?? {};
  // An unset theme width resolves to a junk string ('px', 'undefinedpx'), which
  // <svg width> silently ignores before expanding to fill its container
  const iconWidth = /^\d/.test(String(themedImg.width ?? ''))
    ? themedImg.width
    : undefined;
  const imgStyles: any = {
    ...imgMaxSizeStyles,
    ...themedImg,
    width: iconWidth
  };

  // role='button' divs get no keyboard activation for free
  const keyActivate = (handler: (event: any) => void) => (event: any) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handler(event);
  };

  let content;
  if (recording) {
    content = (
      <>
        <div
          css={{
            color: RECORDING_COLOR,
            display: 'flex',
            flex: 1,
            minWidth: 0
          }}
        >
          <LevelMeter getLevel={getLevel} />
        </div>
        <span
          css={{
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.85em'
          }}
        >
          {formatDuration(elapsed)}
          {maxDuration ? ` / ${formatDuration(maxDuration)}` : ''}
        </span>
        <div
          role='button'
          aria-label={t.stop}
          tabIndex={0}
          onClick={stopRecording}
          onKeyDown={keyActivate(stopRecording)}
          css={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            flexShrink: 0,
            border: `1.5px solid ${RECORDING_COLOR}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            css={{
              width: '12px',
              height: '12px',
              borderRadius: '2px',
              backgroundColor: RECORDING_COLOR
            }}
          />
        </div>
      </>
    );
  } else if (rawFile) {
    content = (
      <>
        {playbackUrl && (
          <AudioPlayer
            src={playbackUrl}
            playLabel={t.play}
            pauseLabel={t.pause}
            knownDuration={recordedSeconds}
            barColor={responsiveStyles.getTarget('bar')?.backgroundColor}
          />
        )}
        {/* A read-only field shouldn't offer to delete the recording */}
        {!disabled && (
          <div
            role='button'
            aria-label={t.clear}
            tabIndex={0}
            onClick={clearRecording}
            onKeyDown={keyActivate(clearRecording)}
            css={{
              color: 'white',
              background: '#AAA',
              height: '16px',
              width: '16px',
              borderRadius: '50%',
              flexShrink: 0,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              transition: '0.2s ease all',
              '&:hover': { backgroundColor: '#BBB' }
            }}
          >
            <CloseIcon fill='white' width={12} height={12} />
          </div>
        )}
      </>
    );
  } else {
    content = (
      <div
        role='button'
        aria-label={element.properties.aria_label || t.record}
        tabIndex={disabled || editMode ? -1 : 0}
        onClick={startRecording}
        onKeyDown={keyActivate(startRecording)}
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          cursor: 'pointer',
          maxWidth: '100%',
          height: '100%',
          minHeight: 0,
          // Image position is a flex direction, same as file upload
          ...themedAc
        }}
      >
        {element.properties.icon ? (
          <img
            src={element.properties.icon}
            style={{
              ...imgStyles,
              maxHeight: '100%',
              flexShrink: stacked ? 1 : 0
            }}
            alt=''
          />
        ) : (
          <MicrophoneIcon
            width={iconWidth ?? '20px'}
            style={{
              ...imgStyles,
              maxHeight: '100%',
              flexShrink: stacked ? 1 : 0
            }}
            color={message ? RECORDING_COLOR : undefined}
          />
        )}
        <span
          role={message ? 'status' : undefined}
          css={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...(message ? { color: RECORDING_COLOR } : {})
          }}
        >
          {message || element.properties.placeholder || t.record}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: editMode || disabled ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          ...responsiveStyles.getTarget('sub-fc')
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            padding: '0 12px',
            gap: '12px',
            ...responsiveStyles.getTarget('field')
          }}
        >
          {content}
        </div>
        {/* This input must always be rendered so we can set field errors */}
        <ErrorInput
          id={servar.key}
          name={servar.key}
          aria-label={fieldAriaLabel(element)}
        />
      </div>
    </div>
  );
}

export default AudioRecordingField;

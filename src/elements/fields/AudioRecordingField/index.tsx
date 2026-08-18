import React, { useEffect, useRef, useState } from 'react';
import { CloseIcon, MicrophoneIcon } from '../../components/icons';
import ErrorInput from '../../components/ErrorInput';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { AudioRecordingTranslations, defaultTranslations } from './translation';
import AudioPlayer from './AudioPlayer';
import LevelMeter from './LevelMeter';

// Ordered by playback compatibility: AAC (.m4a) plays natively everywhere, so
// it leads when the browser can encode it. Bare audio/mp4 trails the webm
// entries because Chrome may fill it with Opus, which .m4a players can't
// decode; only a browser rejecting the explicit AAC codec reaches it.
const MIME_PREFERENCES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

// Extension is always derived from the container the recorder actually used
const EXTENSION_MAP: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3'
};

const RECORDING_COLOR = '#E53935';

// Controls whose activation ends a recording. Scrolls and stray taps don't,
// so a respondent can still read the form while recording.
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [tabindex]';

const formatDuration = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

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
  const [message, setMessage] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef(0);
  // Mic level for the waveform, sampled by its own rAF loop
  const audioCtxRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const levelBufferRef = useRef<Uint8Array | null>(null);
  // Guards double-starts while the mic permission prompt is open
  const startingRef = useRef(false);
  // Set on unmount so an in-flight recording is dropped instead of saved
  const discardRef = useRef(false);

  // Adopt externally set values (session rehydration, logic rules, clears).
  // Recording emits the promise it stores, so its own echo is a no-op set.
  useEffect(() => {
    setRawFile(initialFile ?? null);
  }, [initialFile]);

  useEffect(() => {
    let cancelled = false;
    let url = '';
    // Drop the previous URL up front; it is revoked by this effect's cleanup
    setPlaybackUrl('');
    if (!rawFile) return;
    Promise.resolve(rawFile)
      .then((file: any) => {
        if (cancelled || !file) return;
        url = URL.createObjectURL(file);
        setPlaybackUrl(url);
      })
      // Rehydrated file promises can reject (e.g. offline) — no playback then
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rawFile]);

  useEffect(
    () => () => {
      discardRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      teardownMetering();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      // Recorder onstop stops the tracks; cover the recorder-less case too
      else streamRef.current?.getTracks().forEach((track: any) => track.stop());
    },
    []
  );

  const teardownMetering = () => {
    analyserRef.current = null;
    levelBufferRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => undefined);
  };

  // Read by LevelMeter's rAF loop; returns 0 when metering is unavailable
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

  // A logic rule can disable the field mid-recording, which also hides the
  // stop control — end the recording so the mic isn't left open
  useEffect(() => {
    if ((disabled || editMode) && recording) stopRecording();
  }, [disabled, editMode, recording]);

  // Recording is scoped to this field: moving focus away, activating another
  // control (another field, a step button), or backgrounding the tab ends it,
  // so the mic is never left open while the respondent does something else.
  // Stopping keeps what was recorded — it never discards.
  useEffect(() => {
    if (!recording) return;
    const doc = featheryDoc();
    const isOutside = (node: any) =>
      !!node && !containerRef.current?.contains(node);
    const onFocusIn = (event: any) => {
      // Focus falling back to the body (the record button unmounts once
      // recording starts) isn't the respondent moving on
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
    // isTypeSupported is advisory — some browsers still reject the type for
    // the actual track, so fall back to the browser's default encoding
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

    // Feeds the waveform. Optional: unsupported browsers just get no meter.
    const AudioContextClass = win.AudioContext || win.webkitAudioContext;
    if (AudioContextClass) {
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
    }
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
      if (blob.size === 0) {
        setMessage(t.empty);
        return;
      }

      const extension = EXTENSION_MAP[mimeType] ?? 'webm';
      const file = new File([blob], `${servar.key}.${extension}`, {
        type: mimeType
      });
      // Emit the same promise we hold, so the value echoing back through
      // initialFile doesn't churn the object URL behind the audio element
      const filePromise = Promise.resolve(file);
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

  // role='button' divs get no keyboard activation for free, and recording is
  // the only way to fill this field
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
          maxWidth: '100%'
        }}
      >
        <MicrophoneIcon
          width='20px'
          style={{ flexShrink: 0 }}
          color={message ? RECORDING_COLOR : undefined}
        />
        <span
          role={message ? 'status' : undefined}
          css={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...(message ? { color: RECORDING_COLOR } : {})
          }}
        >
          {message || t.record}
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
          aria-label={element.properties.aria_label}
        />
      </div>
    </div>
  );
}

export default AudioRecordingField;

import React, { useEffect, useRef, useState } from 'react';

// Native <audio controls> can't be themed, renders differently per browser,
// and collapses its scrubber at field width. This draws the same affordances
// in `currentColor`, so it inherits the form theme's field font color.
const formatTime = (seconds: number) => {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

function AudioPlayer({
  src,
  playLabel,
  pauseLabel
}: {
  src: string;
  playLabel: string;
  pauseLabel: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  const onLoaded = () => {
    const value = audioRef.current?.duration ?? 0;
    // A MediaRecorder blob can report Infinity until it has been seeked
    setDuration(isFinite(value) ? value : 0);
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - left) / width, 0), 1);
    audio.currentTime = ratio * duration;
    setCurrent(audio.currentTime);
  };

  const progress = duration ? Math.min(current / duration, 1) : 0;

  return (
    <div
      css={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        // Playback stays usable on a read-only field
        pointerEvents: 'auto'
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload='metadata'
        onLoadedMetadata={onLoaded}
        onDurationChange={onLoaded}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        css={{ display: 'none' }}
      />
      <div
        role='button'
        aria-label={playing ? pauseLabel : playLabel}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
        css={{
          flexShrink: 0,
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
      >
        {playing ? (
          <svg width='12' height='14' viewBox='0 0 12 14' aria-hidden='true'>
            <rect width='4' height='14' rx='1' fill='currentColor' />
            <rect x='8' width='4' height='14' rx='1' fill='currentColor' />
          </svg>
        ) : (
          <svg width='13' height='14' viewBox='0 0 13 14' aria-hidden='true'>
            <path
              d='M1 1.4a1 1 0 0 1 1.5-.9l9 5.6a1 1 0 0 1 0 1.7l-9 5.6a1 1 0 0 1-1.5-.9V1.4Z'
              fill='currentColor'
            />
          </svg>
        )}
      </div>
      <div
        onClick={seek}
        css={{
          flex: 1,
          minWidth: '40px',
          height: '14px',
          display: 'flex',
          alignItems: 'center',
          cursor: duration ? 'pointer' : 'default'
        }}
      >
        <div css={{ position: 'relative', width: '100%', height: '4px' }}>
          {/* Track and fill are siblings: nesting the fill would inherit the
              track's opacity and make progress invisible */}
          <div
            css={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              borderRadius: '2px',
              backgroundColor: 'currentColor',
              opacity: 0.25
            }}
          />
          <div
            css={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              borderRadius: '2px',
              backgroundColor: 'currentColor',
              width: `${progress * 100}%`
            }}
          />
        </div>
      </div>
      <span
        css={{
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
          fontSize: '0.85em',
          whiteSpace: 'nowrap'
        }}
      >
        {formatTime(current)} / {formatTime(duration)}
      </span>
    </div>
  );
}

export default AudioPlayer;

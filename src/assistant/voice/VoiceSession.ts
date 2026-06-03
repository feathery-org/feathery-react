import { MicVAD, utils as vadUtils } from '@ricky0123/vad-web';
import { log as vadLog } from '@ricky0123/vad-web/dist/logging';
import { fetchSpeechStream, transcribeAudio } from './utils';
import type { AssistantHeaders } from '../types';
import { featheryWindow } from '../../utils/browser';

// Silence VAD's hardcoded console logs
vadLog.debug = () => {
  /* silenced */
};

export type VoiceState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

type VoiceListener = (state: VoiceState) => void;

type VoiceSegmentInput = {
  entryIdx: number;
  segmentIdx: number;
  start: number;
  text: string;
};

type VoiceRevealEvent =
  | {
      kind: 'progress';
      entryIdx: number;
      segmentIdx: number;
      chars: number;
    }
  | { kind: 'all' };

type SessionOptions = {
  baseUrl: string;
  headers: AssistantHeaders;
  onTranscript: (text: string) => void;
  onStateChange: VoiceListener;
  onReveal?: (event: VoiceRevealEvent) => void;
};

// CDN-hosted so consumers don't serve the WASM
const VAD_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';
const ORT_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';

// Reveal floor for fast sentences
const REVEAL_FLOOR_CHARS_PER_SEC = 40;
const REVEAL_LEAD_FACTOR = 1.5;

// Seconds of audio to buffer before kicking off playback; cushions byte-flow gaps
const INITIAL_BUFFER_SEC = 0.5;

type QueuedSegment = {
  input: VoiceSegmentInput;
  abort: AbortController;
  streamPromise: Promise<ReadableStream<Uint8Array>>;
};

type SegmentRange = {
  input: VoiceSegmentInput;
  startTime: number;
  endTime: number;
};

export class VoiceSession {
  private opts: SessionOptions;
  private vad: MicVAD | null = null;
  private state: VoiceState = 'idle';

  private ttsQueue: QueuedSegment[] = [];
  private segmentRanges: SegmentRange[] = [];
  private playing = false;
  // Char offset queued per entry; lets playSegment ignore stale re-emits
  private enqueuedUpTo = new Map<number, number>();

  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private currentMediaSource: MediaSource | null = null;
  private currentSourceBuffer: SourceBuffer | null = null;
  private appendChain: Promise<void> = Promise.resolve();

  private finished = false;
  // True once playback actually started this turn; gates the no-audio recovery
  private played = false;
  private rafId: number | null = null;

  // Dedup identical reveal events
  private lastEmittedSegmentKey: string | null = null;
  private lastEmittedChars = 0;

  constructor(opts: SessionOptions) {
    this.opts = opts;
  }

  async start() {
    if (this.state !== 'idle') return;
    this.setState('starting');
    try {
      this.vad = await MicVAD.new({
        baseAssetPath: VAD_ASSET_BASE,
        onnxWASMBasePath: ORT_ASSET_BASE,
        getStream: () =>
          navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          }),
        onSpeechStart: () => this.handleSpeechStart(),
        onSpeechEnd: (audio: Float32Array) => this.handleSpeechEnd(audio)
      });
      this.vad.start();
      this.setState('listening');
    } catch {
      this.setState('error');
      this.vad = null;
    }
  }

  stop() {
    this.vad?.destroy();
    this.vad = null;
    this.cutPlayback();
    this.setState('idle');
  }

  resetForNextTurn() {
    this.cutPlayback();
    this.enqueuedUpTo.clear();
    this.finished = false;
  }

  playSegment(input: VoiceSegmentInput) {
    if (this.state === 'idle') return;
    if (input.start < (this.enqueuedUpTo.get(input.entryIdx) ?? 0)) return;
    this.enqueuedUpTo.set(input.entryIdx, input.start + input.text.length);
    const abort = new AbortController();
    const streamPromise = fetchSpeechStream(
      this.opts.baseUrl,
      this.opts.headers,
      input.text,
      abort.signal
    );
    this.ttsQueue.push({ input, abort, streamPromise });
    if (!this.playing) {
      this.playing = true;
      this.playLoop();
    }
  }

  // Pause mic while awaiting the reply
  markAwaitingResponse() {
    if (this.state === 'idle') return;
    if (this.state === 'listening' || this.state === 'recording') {
      this.setState('thinking');
    }
  }

  finishTurn() {
    if (this.state === 'idle' || this.finished) return;
    this.finished = true;
    this.maybeFinish();
  }

  skipCurrent() {
    if (this.state !== 'speaking') return;
    this.cutPlayback();
    if (this.ttsQueue.length === 0) this.returnToListening();
  }

  private handleSpeechStart() {
    this.setState('recording');
  }

  private async handleSpeechEnd(audio: Float32Array) {
    // Skip sub-0.4s clips; STT hallucinates on noise
    if (audio.length < 6400) return;
    this.resetForNextTurn();
    this.setState('transcribing');
    try {
      const wav = new Blob([vadUtils.encodeWAV(audio)], { type: 'audio/wav' });
      const text = await transcribeAudio(
        this.opts.baseUrl,
        this.opts.headers,
        wav
      );
      if (text) {
        this.setState('thinking');
        this.opts.onTranscript(text);
      } else {
        this.setState('listening');
      }
    } catch {
      this.setState('listening');
    }
  }

  private async playLoop() {
    try {
      if (!this.currentSourceBuffer) {
        try {
          await this.openAudioSession();
        } catch {
          this.ttsQueue = [];
          return;
        }
      }
      while (this.ttsQueue.length > 0) {
        const item = this.ttsQueue.shift();
        if (!item) break;
        try {
          await this.appendSegment(item);
        } catch {
          /* segment failed; recovery handled in maybeFinish */
        }
      }
    } finally {
      this.playing = false;
    }
    this.maybeFinish();
  }

  private openAudioSession(): Promise<void> {
    const audio = new Audio();
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;
    try {
      audio.load();
    } catch {
      /* noop */
    }
    this.currentAudio = audio;
    this.currentObjectUrl = objectUrl;
    this.currentMediaSource = mediaSource;
    this.appendChain = Promise.resolve();
    this.segmentRanges = [];
    this.played = false;

    audio.onended = () => {
      // Underruns fire 'ended' despite duration=Infinity
      if (!this.finished) return;
      this.stopRevealLoop();
      this.emitRevealAll();
      this.teardownAudioSession();
      this.returnToListening();
    };
    audio.onplaying = () => {
      this.played = true;
      if (this.state !== 'idle') this.setState('speaking');
      this.startRevealLoop();
    };
    const onStall = () => {
      if (this.state === 'speaking') this.setState('thinking');
      this.stopRevealLoop();
    };
    audio.onwaiting = onStall;
    audio.onpause = onStall;
    // On a playback error, return to listening instead of getting stuck
    audio.onerror = () => {
      this.stopRevealLoop();
      this.emitRevealAll();
      this.teardownAudioSession();
      this.returnToListening();
    };

    return new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        try {
          const sb = mediaSource.addSourceBuffer('audio/mpeg');
          try {
            sb.mode = 'sequence';
          } catch {
            /* noop */
          }
          try {
            mediaSource.duration = Infinity;
          } catch {
            /* noop */
          }
          this.currentSourceBuffer = sb;
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      mediaSource.addEventListener('sourceopen', onOpen, { once: true });
    });
  }

  private async appendSegment(item: QueuedSegment): Promise<void> {
    const { input, streamPromise, abort } = item;
    const signal = abort.signal;
    const stream = await streamPromise;

    const sb = this.currentSourceBuffer;
    const audio = this.currentAudio;
    if (!sb || !audio) throw new Error('session not open');

    const startTime =
      sb.buffered.length > 0 ? sb.buffered.end(sb.buffered.length - 1) : 0;
    // Rough pace estimate; corrected as chunks land
    const estimatedDurationSec = Math.max(0.3, input.text.length / 22);
    const range: SegmentRange = {
      input,
      startTime,
      endTime: startTime + estimatedDurationSec
    };
    this.segmentRanges.push(range);

    const reader = stream.getReader();
    const onAbort = () => {
      try {
        reader.cancel().catch(() => {});
      } catch {
        /* noop */
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const appendChunk = (chunk: Uint8Array) =>
      new Promise<void>((resolve, reject) => {
        const onEnd = () => {
          sb.removeEventListener('updateend', onEnd);
          sb.removeEventListener('error', onErr);
          resolve();
        };
        const onErr = () => {
          sb.removeEventListener('updateend', onEnd);
          sb.removeEventListener('error', onErr);
          reject(new Error('sourceBuffer error'));
        };
        sb.addEventListener('updateend', onEnd);
        sb.addEventListener('error', onErr);
        try {
          sb.appendBuffer(chunk as BufferSource);
        } catch (err) {
          sb.removeEventListener('updateend', onEnd);
          sb.removeEventListener('error', onErr);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

    // Pre-buffer a cushion before kicking off audio so byte-flow gaps mid-stream don't underrun
    let kicked = !audio.paused && !audio.ended;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      // Bail if aborted or the session was torn down (e.g. voice exited)
      if (signal.aborted || this.currentAudio !== audio) return;
      this.appendChain = this.appendChain.then(() => appendChunk(value));
      await this.appendChain;
      if (sb.buffered.length > 0) {
        range.endTime = sb.buffered.end(sb.buffered.length - 1);
      }
      if (!kicked && sb.buffered.length > 0) {
        const buffered =
          sb.buffered.end(sb.buffered.length - 1) - audio.currentTime;
        if (buffered >= INITIAL_BUFFER_SEC) {
          kicked = true;
          audio.play().catch(() => {
            /* noop */
          });
        }
      }
    }
    // Short segment finished before reaching the cushion threshold; play what we have
    if (!kicked && (audio.paused || audio.ended)) {
      audio.play().catch(() => {
        /* noop */
      });
    }
    if (sb.buffered.length > 0) {
      range.endTime = sb.buffered.end(sb.buffered.length - 1);
    }

    // Restart reveal after an underrun
    if (this.currentAudio && !this.currentAudio.paused) {
      this.startRevealLoop();
    }
  }

  private maybeFinish() {
    if (!this.finished || this.playing || this.ttsQueue.length > 0) return;
    if (
      this.currentMediaSource &&
      this.currentMediaSource.readyState === 'open'
    ) {
      try {
        this.currentMediaSource.endOfStream();
      } catch {
        /* noop */
      }
    }
    // Played audio recovers via 'ended'; if nothing played, recover here so we don't stall
    if (this.currentAudio && this.played && !this.currentAudio.ended) return;
    this.stopRevealLoop();
    this.emitRevealAll();
    this.teardownAudioSession();
    this.returnToListening();
  }

  private teardownAudioSession() {
    if (this.currentObjectUrl) {
      try {
        URL.revokeObjectURL(this.currentObjectUrl);
      } catch {
        /* noop */
      }
    }
    this.currentAudio = null;
    this.currentObjectUrl = null;
    this.currentMediaSource = null;
    this.currentSourceBuffer = null;
    this.appendChain = Promise.resolve();
    this.segmentRanges = [];
    this.played = false;
    this.lastEmittedSegmentKey = null;
    this.lastEmittedChars = 0;
  }

  private cutPlayback() {
    for (const item of this.ttsQueue) {
      item.abort.abort();
      // Swallow the aborted fetch so it isn't an unhandled rejection
      item.streamPromise.catch(() => {});
    }
    this.ttsQueue = [];
    if (
      this.currentMediaSource &&
      this.currentMediaSource.readyState === 'open'
    ) {
      try {
        this.currentMediaSource.endOfStream();
      } catch {
        /* noop */
      }
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
      } catch {
        /* noop */
      }
    }
    this.stopRevealLoop();
    this.teardownAudioSession();
    this.finished = false;
  }

  private startRevealLoop() {
    if (this.rafId !== null) return;
    const tick = () => {
      const audio = this.currentAudio;
      if (!audio || audio.paused) {
        this.rafId = null;
        return;
      }
      this.computeAndEmitReveal(audio.currentTime);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRevealLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    // Flush trailing chars
    const audio = this.currentAudio;
    if (audio) this.computeAndEmitReveal(audio.currentTime);
  }

  private computeAndEmitReveal(t: number) {
    for (let i = 0; i < this.segmentRanges.length; i++) {
      const r = this.segmentRanges[i];
      const textLen = r.input.text.length;
      if (t >= r.endTime) {
        this.emitProgress(r.input, textLen);
        continue;
      }
      if (t >= r.startTime) {
        const audioSpan = Math.max(1e-3, r.endTime - r.startTime);
        const audioRate = textLen / audioSpan;
        const revealRate = Math.max(
          audioRate * REVEAL_LEAD_FACTOR,
          REVEAL_FLOOR_CHARS_PER_SEC
        );
        const interp = Math.min(
          textLen,
          Math.floor(revealRate * (t - r.startTime))
        );
        this.emitProgress(r.input, interp);
        return;
      }
      return;
    }
  }

  private emitProgress(input: VoiceSegmentInput, chars: number) {
    const key = `${input.entryIdx}:${input.segmentIdx}`;
    if (this.lastEmittedSegmentKey === key && this.lastEmittedChars === chars) {
      return;
    }
    this.lastEmittedSegmentKey = key;
    this.lastEmittedChars = chars;
    try {
      this.opts.onReveal?.({
        kind: 'progress',
        entryIdx: input.entryIdx,
        segmentIdx: input.segmentIdx,
        chars
      });
    } catch {
      /* noop */
    }
  }

  private emitRevealAll() {
    try {
      this.opts.onReveal?.({ kind: 'all' });
    } catch {
      /* noop */
    }
  }

  private returnToListening() {
    if (this.state === 'speaking' || this.state === 'thinking')
      this.setState('listening');
  }

  private static readonly VAD_ACTIVE_STATES: ReadonlySet<VoiceState> = new Set([
    'listening',
    'recording',
    'transcribing'
  ]);

  private setState(next: VoiceState) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    if (this.vad) {
      const wasActive = VoiceSession.VAD_ACTIVE_STATES.has(prev);
      const nowActive = VoiceSession.VAD_ACTIVE_STATES.has(next);
      if (wasActive !== nowActive) {
        try {
          nowActive ? this.vad.start() : this.vad.pause();
        } catch {
          /* noop */
        }
      }
    }
    this.opts.onStateChange(next);
  }
}

export async function probeMicAvailable(): Promise<boolean> {
  try {
    const md = (featheryWindow().navigator as Navigator | undefined)
      ?.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return false;
    return true;
  } catch {
    return false;
  }
}

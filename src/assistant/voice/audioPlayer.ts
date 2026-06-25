import { featheryWindow } from '../../utils/browser';

type PlayerOpts = {
  onSegmentStart?: (text: string) => void;
  onSegmentProgress?: (text: string, fraction: number) => void;
  onSegmentEnd?: (text: string) => void;
  onIdle?: () => void;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = featheryWindow().atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Reveal text slightly ahead of the audio so it reads naturally rather than lagging
const REVEAL_LEAD = 1.5;

type Clip = { text: string; bytes: Uint8Array[] };

// Play the turn's audio clip by clip, reporting progress to drive the text reveal
export class AudioPlayer {
  private building: Uint8Array[] = [];
  private queue: Clip[] = [];
  private playIndex = 0;
  private ended = false;
  private playing = false;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private rafId: number | null = null;
  private opts: PlayerOpts;

  constructor(opts: PlayerOpts = {}) {
    this.opts = opts;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  pushChunk(base64: string) {
    this.building.push(base64ToBytes(base64));
  }

  // The sentence's audio is fully sent, queue it (with its text) and keep playback moving
  pushSegment(text: string) {
    this.queue.push({ text, bytes: this.building });
    this.building = [];
    this.playing = true;
    this.playNext();
  }

  // No more clips coming
  end() {
    this.ended = true;
    this.playNext();
  }

  // Cut playback and drop anything queued
  skip() {
    this.teardown();
  }

  private playNext() {
    if (this.audio) return;
    const clip = this.queue[this.playIndex];
    if (!clip) {
      if (this.ended && this.playing) {
        this.playing = false;
        this.opts.onIdle?.();
      }
      return;
    }
    if (clip.bytes.length === 0) {
      // TTS produced no audio for this sentence, credit its text to keep the reveal moving
      this.opts.onSegmentEnd?.(clip.text);
      this.playIndex += 1;
      this.playNext();
      return;
    }
    const url = URL.createObjectURL(
      new Blob(clip.bytes as BlobPart[], { type: 'audio/mpeg' })
    );
    const audio = new Audio(url);
    this.audio = audio;
    this.objectUrl = url;
    audio.onplaying = () => {
      if (this.audio !== audio) return;
      this.opts.onSegmentStart?.(clip.text);
      this.startReveal(audio, clip.text);
    };
    audio.onended = () => this.finishClip(audio, clip.text);
    audio.onerror = () => this.finishClip(audio, clip.text);
    audio.play().catch(() => this.finishClip(audio, clip.text));
  }

  // Drive the text reveal from the clip's playback position
  private startReveal(audio: HTMLAudioElement, text: string) {
    const win = featheryWindow();
    const tick = () => {
      if (this.audio !== audio) {
        this.rafId = null;
        return;
      }
      const d = audio.duration;
      const fraction =
        d && isFinite(d) && d > 0
          ? Math.min(1, (audio.currentTime / d) * REVEAL_LEAD)
          : 0;
      this.opts.onSegmentProgress?.(text, fraction);
      this.rafId = win.requestAnimationFrame(tick);
    };
    this.rafId = win.requestAnimationFrame(tick);
  }

  private stopReveal() {
    if (this.rafId !== null) {
      featheryWindow().cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private finishClip(audio: HTMLAudioElement, text: string) {
    if (this.audio !== audio) return;
    this.stopReveal();
    this.opts.onSegmentEnd?.(text);
    audio.pause();
    audio.src = '';
    this.audio = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.playIndex += 1;
    this.playNext();
  }

  private teardown() {
    this.stopReveal();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.building = [];
    this.queue = [];
    this.playIndex = 0;
    this.ended = false;
    this.playing = false;
    this.opts.onIdle?.();
  }
}

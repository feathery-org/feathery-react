import type { MicVAD } from '@ricky0123/vad-web';

import { featheryWindow } from '../../utils/browser';

// CDN-hosted so consumers don't have to serve the WASM/model assets
const VAD_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';
const ORT_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

// Clips under ~0.4s are noise, STT hallucinates words on them
const MIN_SAMPLES = 6400;

type MicOpts = {
  onSpeechStart: () => void;
  onUtterance: (wav: Blob) => void;
};

export class VoiceMic {
  private vad: MicVAD | null = null;
  private opts: MicOpts;
  private paused = false;

  constructor(opts: MicOpts) {
    this.opts = opts;
  }

  async start(): Promise<boolean> {
    try {
      // Loaded lazily so onnxruntime-web stays out of the core bundle until voice is used
      const { MicVAD, utils: vadUtils } = await import('@ricky0123/vad-web');
      const { log: vadLog } = await import('@ricky0123/vad-web/dist/logging');
      vadLog.debug = () => undefined;
      this.vad = await MicVAD.new({
        baseAssetPath: VAD_ASSET_BASE,
        onnxWASMBasePath: ORT_ASSET_BASE,
        getStream: () =>
          featheryWindow().navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          }),
        onSpeechStart: () => {
          if (!this.paused) this.opts.onSpeechStart();
        },
        onSpeechEnd: (audio: Float32Array) => {
          if (this.paused || audio.length < MIN_SAMPLES) return;
          const wav = new Blob([vadUtils.encodeWAV(audio)], {
            type: 'audio/wav'
          });
          this.opts.onUtterance(wav);
        }
      });
      this.vad.start();
      return true;
    } catch {
      this.vad = null;
      return false;
    }
  }

  // Hot only during the user's turn, off while the assistant thinks and speaks
  pause() {
    this.paused = true;
    this.vad?.pause();
  }

  resume() {
    this.paused = false;
    this.vad?.start();
  }

  destroy() {
    this.vad?.destroy();
    this.vad = null;
  }
}

export function probeMicAvailable(): boolean {
  try {
    const md = featheryWindow().navigator?.mediaDevices;
    return !!md && typeof md.getUserMedia === 'function';
  } catch {
    return false;
  }
}

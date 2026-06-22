import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { v4 as uuidv4 } from 'uuid';

import { AudioPlayer } from './audioPlayer';
import { probeMicAvailable, VoiceMic } from './voiceMic';

const nonWhitespace = (text: string): number => text.replace(/\s/g, '').length;

export type VoiceState =
  | 'idle'
  | 'loading'
  | 'listening'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

type VoiceDataPart = {
  type: string;
  data?: { text?: string; chunk?: string; done?: boolean };
};

type UseAssistantVoiceOptions = {
  status: ChatStatus;
  sendMessage: (message?: { text: string }) => void;
  setMessages: (updater: (prev: any[]) => any[]) => void;
  ensureThread: () => void;
  voiceActiveRef: MutableRefObject<boolean>;
  pendingAudioRef: MutableRefObject<Blob | null>;
  voiceDataRef: MutableRefObject<((part: VoiceDataPart) => void) | null>;
};

export function useAssistantVoice({
  status,
  sendMessage,
  setMessages,
  ensureThread,
  voiceActiveRef,
  pendingAudioRef,
  voiceDataRef
}: UseAssistantVoiceOptions) {
  const [voiceState, setVoiceStateRaw] = useState<VoiceState>('idle');
  const [micAvailable] = useState(probeMicAvailable);
  // Characters of the reply whose audio clip has begun playing, driving the in-order text reveal
  const [spokenChars, setSpokenChars] = useState(0);
  // True while this turn's audio is queued or playing, keeping the reveal paced after the stream closes
  const [audioDraining, setAudioDraining] = useState(false);

  const stateRef = useRef<VoiceState>('idle');
  const statusRef = useRef<ChatStatus>(status);
  const micRef = useRef<VoiceMic | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  // Non-whitespace chars of clips already finished, progress adds the in-flight clip on top
  const baseRef = useRef(0);
  // Set when the user taps skip, muting the rest of this turn's audio
  const skippedRef = useRef(false);

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setVoiceStateRaw(next);
  }, []);

  // Return to listening once the turn ends (done or errored) and audio has drained
  const maybeFinishSpeaking = useCallback(() => {
    if (!voiceActiveRef.current) return;
    if (statusRef.current !== 'ready' && statusRef.current !== 'error') return;
    if (playerRef.current?.isPlaying) return;
    if (
      stateRef.current === 'transcribing' ||
      stateRef.current === 'thinking' ||
      stateRef.current === 'speaking'
    ) {
      micRef.current?.resume();
      setVoiceState('listening');
    }
  }, [voiceActiveRef, setVoiceState]);

  const handleUtterance = useCallback(
    (wav: Blob) => {
      if (stateRef.current !== 'recording' && stateRef.current !== 'listening')
        return;
      pendingAudioRef.current = wav;
      micRef.current?.pause();
      playerRef.current?.skip();
      baseRef.current = 0;
      skippedRef.current = false;
      setSpokenChars(0);
      setVoiceState('transcribing');
      ensureThread();
      // Send an empty user message so the turn anchors on it like a typed one
      sendMessage({ text: '' });
    },
    [pendingAudioRef, ensureThread, sendMessage, setVoiceState]
  );

  // Mic is created once, route through a ref to reach the current handler
  const handleUtteranceRef = useRef(handleUtterance);
  handleUtteranceRef.current = handleUtterance;

  const startVoice = useCallback(async () => {
    if (stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    const player = new AudioPlayer({
      onSegmentStart: () => {
        if (voiceActiveRef.current) setVoiceState('speaking');
      },
      onSegmentProgress: (text, fraction) =>
        setSpokenChars(
          baseRef.current + Math.floor(nonWhitespace(text) * fraction)
        ),
      onSegmentEnd: (text) => {
        baseRef.current += nonWhitespace(text);
        setSpokenChars(baseRef.current);
      },
      onIdle: () => {
        setAudioDraining(false);
        maybeFinishSpeaking();
      }
    });
    const mic = new VoiceMic({
      onSpeechStart: () => {
        if (stateRef.current === 'listening') setVoiceState('recording');
      },
      onUtterance: (wav) => handleUtteranceRef.current(wav)
    });
    playerRef.current = player;
    micRef.current = mic;
    voiceActiveRef.current = true;
    // Stays 'loading' until the VAD assets finish downloading, only then is the mic live
    setVoiceState('loading');
    const ok = await mic.start();
    if (!ok) {
      voiceActiveRef.current = false;
      setVoiceState('error');
    } else {
      setVoiceState('listening');
    }
  }, [voiceActiveRef, maybeFinishSpeaking, setVoiceState]);

  const stopVoice = useCallback(() => {
    micRef.current?.destroy();
    micRef.current = null;
    playerRef.current?.skip();
    playerRef.current = null;
    pendingAudioRef.current = null;
    voiceActiveRef.current = false;
    setVoiceState('idle');
  }, [voiceActiveRef, pendingAudioRef, setVoiceState]);

  const skipSpeaking = useCallback(() => {
    if (stateRef.current !== 'speaking') return;
    skippedRef.current = true;
    playerRef.current?.skip();
    // Audio is muted, so reveal the rest of the reply text immediately
    setSpokenChars(Number.MAX_SAFE_INTEGER);
  }, []);

  // Route the transient transcript + audio parts coming off the chat stream
  useEffect(() => {
    voiceDataRef.current = (part) => {
      if (!voiceActiveRef.current) return;
      if (part.type === 'data-audio') {
        if (part.data?.done) playerRef.current?.end();
        else if (part.data?.chunk && !skippedRef.current)
          playerRef.current?.pushChunk(part.data.chunk);
      } else if (part.type === 'data-segment' && part.data?.text) {
        if (skippedRef.current) return;
        setAudioDraining(true);
        playerRef.current?.pushSegment(part.data.text);
      } else if (part.type === 'data-transcript' && part.data?.text) {
        const text = part.data.text;
        // Transcript is in, the agent is now working on the reply
        if (stateRef.current === 'transcribing') setVoiceState('thinking');
        // Fill the empty user message this turn was sent with
        setMessages((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'user') {
              const next = [...prev];
              next[i] = { ...prev[i], parts: [{ type: 'text', text }] };
              return next;
            }
          }
          return [
            ...prev,
            { id: uuidv4(), role: 'user', parts: [{ type: 'text', text }] }
          ];
        });
      }
    };
    return () => {
      voiceDataRef.current = null;
    };
  }, [voiceDataRef, voiceActiveRef, setMessages, setVoiceState]);

  useEffect(() => {
    statusRef.current = status;
    // A turn that ends with the user message still empty had no usable transcript, drop it
    if ((status === 'ready' || status === 'error') && voiceActiveRef.current) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const emptyUser =
          last?.role === 'user' &&
          !(last.parts ?? []).some(
            (p: any) => p.type === 'text' && (p.text ?? '').trim()
          );
        return emptyUser ? prev.slice(0, -1) : prev;
      });
    }
    maybeFinishSpeaking();
  }, [status, maybeFinishSpeaking, voiceActiveRef, setMessages]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  return {
    voiceState,
    voiceActive: voiceState !== 'idle' && voiceState !== 'error',
    micAvailable,
    spokenChars,
    audioDraining,
    startVoice,
    stopVoice,
    skipSpeaking
  };
}

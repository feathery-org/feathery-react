import { useCallback, useEffect, useRef, useState } from 'react';

import {
  VoiceSession,
  type VoiceState,
  probeMicAvailable
} from '../voice/VoiceSession';
import { mergeAssistantParts } from '../utils';
import type { AssistantHeaders } from '../types';

// Sentence splitter; segments rejoin to the exact source
type Segment = {
  text: string;
  start: number;
};

type SplitResult = {
  segments: Segment[];
  consumedUpTo: number;
};

// Split on sentence ends, but not abbreviations ("Mr.") or decimals ("3.14")
const SENTENCE_RE = /[^.!?\n]{4,}?[.!?]+/g;

const isWs = (ch: string) => /\s/.test(ch);

function splitSentences(
  source: string,
  fromOffset: number,
  flush: boolean
): SplitResult {
  const segments: Segment[] = [];
  let cursor = fromOffset;

  const emit = (end: number) => {
    const text = source.slice(cursor, end);
    if (text.trim().length > 0) segments.push({ text, start: cursor });
    cursor = end;
  };

  while (cursor < source.length) {
    // Newlines (bullets/paragraphs) are always confirmed boundaries
    const nl = source.indexOf('\n', cursor);

    // Sentence end: terminator + whitespace, or end-of-buffer only on flush
    let sentEnd = -1;
    SENTENCE_RE.lastIndex = cursor;
    while (true) {
      const match = SENTENCE_RE.exec(source);
      if (!match) break;
      const endPos = SENTENCE_RE.lastIndex;
      if (endPos < source.length) {
        if (isWs(source[endPos])) {
          sentEnd = endPos;
          break;
        }
        // False terminator like ".1" in "3.14"
        continue;
      }
      if (flush) sentEnd = endPos;
      break;
    }

    if (nl !== -1 && (sentEnd === -1 || nl < sentEnd)) emit(nl + 1);
    else if (sentEnd !== -1) emit(sentEnd);
    else break;
  }

  if (flush && cursor < source.length) emit(source.length);

  return { segments, consumedUpTo: cursor };
}

type EntryVoiceState = {
  segments: Segment[];
  scannedUpTo: number;
  revealedCount: number;
  currentChars: number;
  revealAll: boolean;
};
type MsgVoiceState = {
  entries: EntryVoiceState[];
};

type Params = {
  baseUrl: string;
  headers: AssistantHeaders;
  messages: any[];
  status: string;
  sendMessage: (message: any) => void;
  stop: () => void;
  onBeforeSend: () => void;
};

// Continuous voice mode as an I/O overlay around the existing chat agent
export default function useAssistantVoice({
  baseUrl,
  headers,
  messages,
  status,
  sendMessage,
  stop,
  onBeforeSend
}: Params) {
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [micAvailable, setMicAvailable] = useState(true);
  const [voiceStateByMsg, setVoiceStateByMsg] = useState<
    Record<string, MsgVoiceState>
  >({});
  const lastAssistantIdRef = useRef<string | null>(null);
  const finishedMsgIdRef = useRef<string | null>(null);

  // Check mic access on mount; shut voice down on unmount
  useEffect(() => {
    let mounted = true;
    probeMicAvailable().then((ok) => {
      if (mounted) setMicAvailable(ok);
    });
    return () => {
      mounted = false;
      voiceSessionRef.current?.stop();
      voiceSessionRef.current = null;
    };
  }, []);

  const revealAllInFlight = useCallback(() => {
    const mid = lastAssistantIdRef.current;
    if (!mid) return;
    setVoiceStateByMsg((prev) => {
      const current = prev[mid];
      if (!current) return prev;
      if (current.entries.every((e) => e.revealAll)) return prev;
      return {
        ...prev,
        [mid]: {
          entries: current.entries.map((e) => ({ ...e, revealAll: true }))
        }
      };
    });
  }, []);

  // Speak each new sentence as the reply streams, and track how much text to reveal
  useEffect(() => {
    if (voiceState === 'idle' || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    const isNewMsg = last.id !== lastAssistantIdRef.current;
    if (isNewMsg) {
      revealAllInFlight();
      lastAssistantIdRef.current = last.id;
      setVoiceStateByMsg((prev) => ({
        ...prev,
        [last.id]: { entries: [] }
      }));
      voiceSessionRef.current?.resetForNextTurn();
    }
    const parts = last.parts as any[];
    const entries = mergeAssistantParts(parts);

    // Turn done: ready and last part is text (no tool continuation pending)
    const lastPart = parts[parts.length - 1];
    const lastIsText = lastPart?.type === 'text';
    const turnDone =
      status === 'ready' && lastIsText && finishedMsgIdRef.current !== last.id;

    // Gather the sentences that just completed so we can speak them
    const current = voiceStateByMsg[last.id] ?? { entries: [] };
    const segmentsToPlay: Array<{
      entryIdx: number;
      segmentIdx: number;
      start: number;
      text: string;
    }> = [];
    let changed = isNewMsg;
    const nextEntries: EntryVoiceState[] = entries.map((entry, entryIdx) => {
      const existing = current.entries[entryIdx];
      const blank: EntryVoiceState = {
        segments: [],
        scannedUpTo: 0,
        revealedCount: 0,
        currentChars: 0,
        revealAll: false
      };
      if (entry.kind !== 'text') return existing ?? blank;
      const base = existing ?? blank;
      // Closed: a later chunk follows, so this text won't grow further
      const closed = entryIdx < entries.length - 1;
      const flush = turnDone || closed;
      const grew = entry.text.length > base.scannedUpTo;
      if (!grew && !flush) {
        if (!existing) changed = true;
        return base;
      }
      const { segments, consumedUpTo } = splitSentences(
        entry.text,
        base.scannedUpTo,
        flush
      );
      if (segments.length === 0 && consumedUpTo === base.scannedUpTo) {
        if (!existing) changed = true;
        return base;
      }
      changed = true;
      for (let i = 0; i < segments.length; i++) {
        const segText = segments[i].text;
        if (!segText) continue;
        segmentsToPlay.push({
          entryIdx,
          segmentIdx: base.segments.length + i,
          start: segments[i].start,
          text: segText
        });
      }
      return {
        ...base,
        segments: [...base.segments, ...segments],
        scannedUpTo: consumedUpTo
      };
    });

    if (changed) {
      setVoiceStateByMsg((prev) => ({
        ...prev,
        [last.id]: { entries: nextEntries }
      }));
    }

    const session = voiceSessionRef.current;
    if (session) {
      for (const seg of segmentsToPlay) session.playSegment(seg);
    }

    if (turnDone) {
      finishedMsgIdRef.current = last.id;
      voiceSessionRef.current?.finishTurn();
    }
  }, [messages, status, voiceState]);

  const sendVoiceTranscript = useCallback(
    (text: string) => {
      if (!text) return;
      onBeforeSend();
      voiceSessionRef.current?.markAwaitingResponse();
      sendMessage({ text });
    },
    [onBeforeSend, sendMessage]
  );

  // Always run the latest send logic when a transcript arrives
  const onTranscriptRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    onTranscriptRef.current = (text: string) => {
      // New transcript mid-stream: interrupt the reply
      if (status === 'streaming' || status === 'submitted') {
        try {
          stop();
        } catch {
          /* noop */
        }
        // Skip; next transcript lands after teardown
        return;
      }
      sendVoiceTranscript(text);
    };
  }, [status, stop, sendVoiceTranscript]);

  const startVoice = useCallback(async () => {
    if (voiceSessionRef.current) return;
    // Don't re-TTS an existing assistant tail
    const tail = messages[messages.length - 1];
    if (tail && tail.role === 'assistant') {
      lastAssistantIdRef.current = tail.id;
      finishedMsgIdRef.current = tail.id;
      const tailEntries = mergeAssistantParts((tail as any).parts ?? []);
      setVoiceStateByMsg((prev) => ({
        ...prev,
        [tail.id]: {
          entries: tailEntries.map((entry) => {
            if (entry.kind !== 'text') {
              return {
                segments: [],
                scannedUpTo: 0,
                revealedCount: 0,
                currentChars: 0,
                revealAll: true
              };
            }
            return {
              segments: [],
              scannedUpTo: entry.text.length,
              revealedCount: 0,
              currentChars: 0,
              revealAll: true
            };
          })
        }
      }));
    }
    const session = new VoiceSession({
      baseUrl,
      headers,
      onTranscript: (text) => onTranscriptRef.current(text),
      onStateChange: (s) => setVoiceState(s),
      onReveal: (event) => {
        const mid = lastAssistantIdRef.current;
        if (!mid) return;
        setVoiceStateByMsg((prev) => {
          const current = prev[mid];
          if (!current) return prev;
          if (event.kind === 'all') {
            if (current.entries.every((e) => e.revealAll)) return prev;
            return {
              ...prev,
              [mid]: {
                entries: current.entries.map((e) => ({ ...e, revealAll: true }))
              }
            };
          }
          const entries = current.entries.slice();
          const e = entries[event.entryIdx];
          if (!e) return prev;
          let { revealedCount, currentChars } = e;
          if (event.segmentIdx > revealedCount) {
            // Treat skipped segments as revealed
            revealedCount = event.segmentIdx;
            currentChars = event.chars;
          } else if (event.segmentIdx === revealedCount) {
            const segText = e.segments[event.segmentIdx]?.text ?? '';
            currentChars = Math.max(currentChars, event.chars);
            if (currentChars >= segText.length) {
              revealedCount = revealedCount + 1;
              currentChars = 0;
            }
          } else {
            return prev;
          }
          if (
            revealedCount === e.revealedCount &&
            currentChars === e.currentChars
          ) {
            return prev;
          }
          entries[event.entryIdx] = { ...e, revealedCount, currentChars };
          return { ...prev, [mid]: { entries } };
        });
      }
    });
    voiceSessionRef.current = session;
    await session.start();
  }, [baseUrl, headers, messages]);

  const stopVoice = useCallback(() => {
    voiceSessionRef.current?.stop();
    voiceSessionRef.current = null;
    setVoiceState('idle');
    revealAllInFlight();
  }, [revealAllInFlight]);

  const handlePillTap = useCallback(() => {
    if (voiceState === 'speaking') {
      voiceSessionRef.current?.skipCurrent();
      revealAllInFlight();
      try {
        stop();
      } catch {
        /* noop */
      }
    }
  }, [voiceState, stop, revealAllInFlight]);

  // Lets the outgoing chat request flag voice mode
  const getVoiceActive = useCallback(() => voiceSessionRef.current != null, []);

  return {
    voiceState,
    voiceActive: voiceState !== 'idle',
    micAvailable,
    voiceStateByMsg,
    startVoice,
    stopVoice,
    handlePillTap,
    getVoiceActive
  };
}

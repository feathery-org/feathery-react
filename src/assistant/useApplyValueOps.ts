import { useEffect, useRef, useState } from 'react';

import type { AssistantChangeOp } from './changeOpHandlers/types';
import { useChangeOpApply } from './useChangeOpApply';

/**
 * Receives `data-changeop` parts emitted by the Assistant agent's write
 * tools, queues them, and processes sequentially through the resource-
 * handler registry. Mirrors Builder's `useOpQueue`: append-on-receive,
 * single in-flight processor, abort flag for cancel-on-unmount.
 *
 * The component derives the "applying" indicator by inspecting the
 * in-flight assistant message's parts (cleanest source of truth, no
 * additional state tracking needed). This hook only exposes the queue
 * length and the data-part handler.
 */
type DataPart = { type: string; data: unknown };

export function useApplyValueOps(formUuid: string | undefined) {
  const { applyChangeOp } = useChangeOpApply(formUuid);

  const appliedOpIds = useRef<Set<string>>(new Set());
  const queueRef = useRef<AssistantChangeOp[]>([]);
  const processingRef = useRef(false);
  const abortRef = useRef(false);
  const [queueLen, setQueueLen] = useState(0);

  useEffect(() => {
    abortRef.current = false;
    return () => {
      abortRef.current = true;
      queueRef.current = [];
    };
  }, []);

  const drain = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length > 0 && !abortRef.current) {
        const op = queueRef.current.shift()!;
        setQueueLen(queueRef.current.length);
        try {
          await applyChangeOp(op);
        } catch (err) {
          // Soft-fail: log and continue. A bad op shouldn't block siblings.
          // eslint-disable-next-line no-console
          console.error('[useApplyValueOps] apply failed', { opId: op.id, err });
        }
      }
    } finally {
      processingRef.current = false;
    }
  };

  const handleDataPart = (dataPart: DataPart) => {
    if (dataPart.type !== 'data-changeop') return;
    const op = dataPart.data as AssistantChangeOp;
    if (!op || op.target?.type !== 'servar_value') return;
    if (appliedOpIds.current.has(op.id)) return;
    appliedOpIds.current.add(op.id);
    queueRef.current.push(op);
    setQueueLen(queueRef.current.length);
    void drain();
  };

  return { handleDataPart, queueLen };
}

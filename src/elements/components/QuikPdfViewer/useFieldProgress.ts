import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { FieldLayer, ValidationIssue } from './fieldLayer/types';
import { toQuikFieldName } from './fieldLayer/serialize';
import { featheryWindow } from '../../../utils/browser';

const RECOUNT_DEBOUNCE_MS = 400;

export function useFieldProgress(
  fieldLayer: FieldLayer,
  canvasRef: RefObject<HTMLElement | null>,
  docsLoadedKey: string,
  remountKey: number
) {
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const runIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const recount = useCallback(async () => {
    const runId = ++runIdRef.current;
    try {
      const result = await fieldLayer.validate();
      if (runIdRef.current === runId) setIssues(result);
    } catch {
      // Counting is best-effort; the sign-time validate gate still applies.
    }
  }, [fieldLayer]);

  const scheduleRecount = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(recount, RECOUNT_DEBOUNCE_MS);
  }, [recount]);

  useEffect(() => {
    scheduleRecount();
  }, [scheduleRecount, docsLoadedKey, remountKey]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    el.addEventListener('input', scheduleRecount, true);
    el.addEventListener('change', scheduleRecount, true);
    return () => {
      el.removeEventListener('input', scheduleRecount, true);
      el.removeEventListener('change', scheduleRecount, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduleRecount, canvasRef]);

  const jumpToNextField = useCallback(() => {
    const container = canvasRef.current;
    if (!container || !issues?.length) return;
    const wanted = new Set(issues.map((i) => i.fieldName));
    const inputs = container.querySelectorAll<HTMLElement>(
      'input[name], textarea[name], select[name]'
    );
    const reduceMotion = featheryWindow().matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    for (const el of Array.from(inputs)) {
      const name = el.getAttribute('name') ?? '';
      if (wanted.has(toQuikFieldName(name))) {
        el.scrollIntoView({
          block: 'center',
          behavior: reduceMotion ? 'auto' : 'smooth'
        });
        el.focus({ preventScroll: true });
        return;
      }
    }
  }, [issues, canvasRef]);

  return {
    requiredRemaining: issues === null ? null : issues.length,
    jumpToNextField
  };
}

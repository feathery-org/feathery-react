import { useEffect, useRef } from 'react';
import { featheryDoc, featheryWindow } from './browser';

// Run `onRefresh` when the tab/window regains focus — on `focus` and on
// `visibilitychange` back to visible — e.g. to re-pull server state after the
// user returns from an external tab. Overlapping runs are skipped while one is
// in flight, and nothing is bound while `enabled` is false.
export default function useRefreshOnFocus(
  onRefresh: () => void | Promise<void>,
  enabled = true
) {
  // Latest callback, read without resubscribing when its identity changes.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      Promise.resolve(onRefreshRef.current()).finally(() => {
        inFlight.current = false;
      });
    };
    const onVisible = () => {
      if (featheryDoc().visibilityState === 'visible') run();
    };
    const win = featheryWindow();
    const doc = featheryDoc();
    win.addEventListener('focus', run);
    doc.addEventListener('visibilitychange', onVisible);
    return () => {
      win.removeEventListener('focus', run);
      doc.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}

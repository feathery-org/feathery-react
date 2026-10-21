import { useEffect, useRef } from 'react';
import { featheryDoc } from '../../../../utils/browser';

// Close an open popover on an outside mousedown or Escape. `isInside` guards
// clicks within the popover: React's stopPropagation does not stop this native
// document listener, so containment must be checked here.
export function useOutsideClose(
  active: boolean,
  onClose: () => void,
  isInside: (target: Node) => boolean
) {
  const onCloseRef = useRef(onClose);
  const isInsideRef = useRef(isInside);
  onCloseRef.current = onClose;
  isInsideRef.current = isInside;

  useEffect(() => {
    if (!active) return;
    const doc = featheryDoc();
    const onDown = (e: MouseEvent) => {
      if (!isInsideRef.current(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('mousedown', onDown);
      doc.removeEventListener('keydown', onKey);
    };
  }, [active]);
}

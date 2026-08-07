import React, {
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc, featheryWindow } from '../../../../utils/browser';
import { menuPanel } from './styles';

// Minimum gap between a panel edge and the viewport edge.
const EDGE_PAD = 8;

interface MenuProps {
  trigger: (o: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'center' | 'end';
  onClose?: () => void;
}

// Dropdown anchored to its trigger; the panel renders in a portal on
// document.body (see menuPanel in styles.ts for why).
export default function Menu({
  trigger,
  children,
  align = 'start',
  onClose
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  // Horizontal correction keeping the panel on-screen; null = not yet
  // measured for this open.
  const [shift, setShift] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The panel anchors to its trigger, so near a viewport edge part of it can
  // land offscreen — e.g. the More dropdown (align='end' extends LEFT of the
  // trigger) on a narrow embed clipped every group's leading buttons. Measure
  // once per open, pre-paint, and shift the panel back into view.
  useLayoutEffect(() => {
    if (!open) {
      setShift(null);
      return;
    }
    if (shift !== null) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vw = featheryWindow().innerWidth;
    let dx = 0;
    if (rect.left < EDGE_PAD) dx = EDGE_PAD - rect.left;
    else if (rect.right > vw - EDGE_PAD) dx = vw - EDGE_PAD - rect.right;
    setShift(dx);
  }, [open, shift]);

  useEffect(() => {
    if (!open) return;
    const doc = featheryDoc();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      // Ignore clicks on the trigger or inside ANY toolbar menu panel (panels
      // are portaled to body, incl. menus nested inside the "More" panel).
      if (ref.current?.contains(t) || t.closest?.('[data-docx-menu]')) return;
      setOpen(false);
      onClose?.();
    };
    doc.addEventListener('mousedown', onDown);
    return () => doc.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 4,
        left:
          align === 'start'
            ? r.left
            : align === 'center'
            ? r.left + r.width / 2
            : r.right
      });
    }
    setOpen((o) => !o);
  };

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <div css={{ position: 'relative' }} ref={ref}>
      {trigger({ open, toggle })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            data-docx-menu=''
            css={menuPanel(align)}
            style={{ top: pos.top, left: pos.left + (shift ?? 0) }}
          >
            {children(close)}
          </div>,
          featheryDoc().body
        )}
    </div>
  );
}

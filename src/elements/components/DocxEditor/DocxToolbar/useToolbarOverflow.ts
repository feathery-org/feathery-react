import { useLayoutEffect, useRef, useState } from 'react';
import { GROUP_KEYS } from './groups';
import { EDGE_PAD, ROW_GAP } from './styles';

// Slot key for the More trigger in the measurement row.
export const MORE_KEY = '__more';

// Responsive tail-first collapse for the tool row. Widths come from a hidden
// measurement row (which always renders every group at natural size), so
// visibleCount is a pure function of observed sizes — rendering fewer groups
// can never feed back into the inputs and loop.
export function useToolbarOverflow() {
  const centerRef = useRef<HTMLDivElement | null>(null);
  const measureRowRef = useRef<HTMLDivElement | null>(null);
  // Group spans in the hidden measurement row, keyed by group key (plus
  // MORE_KEY for the More trigger). Elements rather than widths — widths are
  // read fresh on every recompute so in-place resizes can't go stale.
  const measureElsRef = useRef(new Map<string, HTMLElement>());
  // Callback-ref state (not a plain ref) so a remounting action region is
  // re-observed automatically, with no dependency lists to keep in sync.
  const [actionEl, setActionEl] = useState<HTMLDivElement | null>(null);
  const [actionWidth, setActionWidth] = useState(0);
  // How many leading tool groups render inline; the rest live in "More".
  const [visibleCount, setVisibleCount] = useState<number>(GROUP_KEYS.length);

  useLayoutEffect(() => {
    if (!actionEl) {
      setActionWidth(0);
      return;
    }
    const updateActionWidth = () =>
      setActionWidth(Math.ceil(actionEl.getBoundingClientRect().width));
    updateActionWidth();
    const observer = new ResizeObserver(updateActionWidth);
    observer.observe(actionEl);
    return () => observer.disconnect();
  }, [actionEl]);

  // How many leading groups fit in the centered layer, keeping room for the
  // More trigger whenever anything is hidden.
  const recompute = () => {
    const center = centerRef.current;
    if (!center) return;
    // -1 tolerance for sub-pixel rounding: err toward collapsing a group one
    // pixel early rather than ever overlapping the action buttons.
    const available = center.getBoundingClientRect().width - 1;
    const els = measureElsRef.current;
    const widths = GROUP_KEYS.map(
      (k) => els.get(k)?.getBoundingClientRect().width ?? 0
    );
    const moreWidth = els.get(MORE_KEY)?.getBoundingClientRect().width ?? 0;
    const rowWidth = (count: number) => {
      let w = 0;
      for (let i = 0; i < count; i++) w += widths[i] + (i > 0 ? ROW_GAP : 0);
      if (count < GROUP_KEYS.length) {
        w += (count > 0 ? ROW_GAP : 0) + moreWidth;
      }
      return w;
    };
    let n = GROUP_KEYS.length;
    while (n > 0 && rowWidth(n) > available) n--;
    setVisibleCount((current) => (current === n ? current : n));
  };

  // Runs pre-paint on mount and again when the action inset lands (at mount
  // the centered layer is measured before actionWidth has flushed, i.e. too
  // wide), so the first paint already shows the fitted row — no overflow
  // flash. In hosted forms the container often gets its final size only
  // after mount, so a one-shot measurement is not enough:
  useLayoutEffect(() => {
    recompute();
  }, [actionWidth]);

  // ...the ResizeObserver keeps the row fitted from then on. The centered
  // layer tracks container/window resizes; the hidden row tracks natural
  // width changes of the tools themselves (e.g. the font-size trigger's
  // label). Neither size depends on visibleCount, so this cannot loop.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(recompute);
    if (centerRef.current) observer.observe(centerRef.current);
    if (measureRowRef.current) observer.observe(measureRowRef.current);
    return () => observer.disconnect();
  }, []);

  const setMeasureEl = (key: string) => (el: HTMLSpanElement | null) => {
    if (el) measureElsRef.current.set(key, el);
  };

  // The centered layer mirrors the action side's full clearance (edge padding
  // + action width + gap) on the left, keeping the tool cluster centered.
  const centerSideInset = EDGE_PAD + (actionWidth ? actionWidth + 8 : 0);

  return {
    centerRef,
    measureRowRef,
    setMeasureEl,
    visibleCount,
    actionRef: setActionEl,
    centerSideInset
  };
}

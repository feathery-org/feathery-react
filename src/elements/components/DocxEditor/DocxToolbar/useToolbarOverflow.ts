import { useLayoutEffect, useRef, useState } from 'react';
import { GROUP_KEYS } from './groups';
import { EDGE_PAD, ROW_GAP } from './styles';

// Slot key for the More trigger in the measurement row.
export const MORE_KEY = '__more';
// Below this toolbar width the action region drops verbose content (the
// "Unsaved changes" label collapses to its dot) so the tool row keeps room
// for at least the More trigger. Keyed off the toolbar's own width — which
// never depends on what the toolbar renders — so it cannot feed back into
// the fit computation and oscillate.
const COMPACT_BREAKPOINT = 560;

interface OverflowState {
  /** How many leading tool groups render inline; the rest live in "More". */
  visibleCount: number;
  /** True when the full row fits centered against the page; otherwise the
   *  row is anchored at the toolbar's left edge to maximize visible tools. */
  centered: boolean;
}

// Responsive tail-first collapse for the tool row. Widths come from a hidden
// measurement row (which always renders every group at natural size), so the
// result is a pure function of observed sizes — rendering fewer groups can
// never feed back into the inputs and loop.
//
// Centering is a preference, not a constraint. The right side must always
// clear the pinned action buttons, but mirroring that clearance on the left
// (for true page-centering) is only done while every group fits within the
// mirrored bounds. Otherwise the left inset collapses to the edge padding and
// the tools take all remaining space — down to, at minimum, the More trigger
// anchored at the left edge where it can never be clipped away.
export function useToolbarOverflow() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measureRowRef = useRef<HTMLDivElement | null>(null);
  // Group spans in the hidden measurement row, keyed by group key (plus
  // MORE_KEY for the More trigger). Elements rather than widths — widths are
  // read fresh on every recompute so in-place resizes can't go stale.
  const measureElsRef = useRef(new Map<string, HTMLElement>());
  // Callback-ref state (not a plain ref) so a remounting action region is
  // re-observed automatically, with no dependency lists to keep in sync.
  const [actionEl, setActionEl] = useState<HTMLDivElement | null>(null);
  const [actionWidth, setActionWidth] = useState(0);
  // Mirrors actionWidth for reads from ResizeObserver callbacks, which
  // capture the first render's closure.
  const actionWidthRef = useRef(0);
  const [rootWidth, setRootWidth] = useState(0);
  const [overflow, setOverflow] = useState<OverflowState>({
    visibleCount: GROUP_KEYS.length,
    centered: true
  });

  useLayoutEffect(() => {
    if (!actionEl) {
      actionWidthRef.current = 0;
      setActionWidth(0);
      return;
    }
    const updateActionWidth = () => {
      const width = Math.ceil(actionEl.getBoundingClientRect().width);
      actionWidthRef.current = width;
      setActionWidth(width);
    };
    updateActionWidth();
    const observer = new ResizeObserver(updateActionWidth);
    observer.observe(actionEl);
    return () => observer.disconnect();
  }, [actionEl]);

  const recompute = () => {
    const root = rootRef.current;
    if (!root) return;
    const width = root.getBoundingClientRect().width;
    setRootWidth((current) => (current === width ? current : width));

    const els = measureElsRef.current;
    const widths = GROUP_KEYS.map(
      (k) => els.get(k)?.getBoundingClientRect().width ?? 0
    );
    const moreWidth = els.get(MORE_KEY)?.getBoundingClientRect().width ?? 0;
    const rowWidth = (count: number, withMore: boolean) => {
      let w = 0;
      for (let i = 0; i < count; i++) w += widths[i] + (i > 0 ? ROW_GAP : 0);
      if (withMore) w += (count > 0 ? ROW_GAP : 0) + moreWidth;
      return w;
    };

    const clearance =
      EDGE_PAD + (actionWidthRef.current ? actionWidthRef.current + 8 : 0);
    // -1 tolerance for sub-pixel rounding: err toward collapsing a group one
    // pixel early rather than ever overlapping the action buttons.
    const symmetricAvailable = width - 2 * clearance - 1;
    const maxAvailable = width - EDGE_PAD - clearance - 1;
    const fullWidth = rowWidth(GROUP_KEYS.length, false);

    let next: OverflowState;
    if (fullWidth <= symmetricAvailable) {
      // Everything fits with the action clearance mirrored on the left:
      // true page-centering.
      next = { visibleCount: GROUP_KEYS.length, centered: true };
    } else if (fullWidth <= maxAvailable) {
      // Everything still fits if the tools take the whole width left of the
      // actions — prefer showing all tools over centering them.
      next = { visibleCount: GROUP_KEYS.length, centered: false };
    } else {
      let n = GROUP_KEYS.length - 1;
      while (n > 0 && rowWidth(n, true) > maxAvailable) n--;
      next = { visibleCount: n, centered: false };
    }
    setOverflow((current) =>
      current.visibleCount === next.visibleCount &&
      current.centered === next.centered
        ? current
        : next
    );
  };

  // Runs pre-paint on mount and again when the action width lands (at mount
  // the first pass runs before the action region has been measured), so the
  // first paint already shows the fitted row — no overflow flash. In hosted
  // forms the container often gets its final size only after mount, so a
  // one-shot measurement is not enough:
  useLayoutEffect(() => {
    recompute();
  }, [actionWidth]);

  // ...the ResizeObserver keeps the row fitted from then on. The toolbar
  // root tracks container/window resizes; the hidden row tracks natural
  // width changes of the tools themselves (e.g. the font-size trigger's
  // label). Neither size depends on visibleCount, so this cannot loop.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(recompute);
    if (rootRef.current) observer.observe(rootRef.current);
    if (measureRowRef.current) observer.observe(measureRowRef.current);
    return () => observer.disconnect();
  }, []);

  const setMeasureEl = (key: string) => (el: HTMLSpanElement | null) => {
    if (el) measureElsRef.current.set(key, el);
  };

  const clearance = EDGE_PAD + (actionWidth ? actionWidth + 8 : 0);
  return {
    rootRef,
    measureRowRef,
    setMeasureEl,
    actionRef: setActionEl,
    visibleCount: overflow.visibleCount,
    centered: overflow.centered,
    // Layer bounds for the tool row: the right side always clears the pinned
    // actions; the left side only mirrors it while centered.
    layerLeft: overflow.centered ? clearance : EDGE_PAD,
    layerRight: clearance,
    compact: rootWidth > 0 && rootWidth < COMPACT_BREAKPOINT
  };
}

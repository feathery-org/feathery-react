import { useEffect, useRef } from 'react';
import { PanelTab } from './DocumentPanel';

export type ActivePanel = PanelTab | null;

/** Open Changes when pending edits first appear, without overriding a later user choice. */
function nextActivePanel(input: {
  activePanel: string | null;
  previousCount: number;
  count: number;
  reviewChanges: boolean;
}): 'changes' | null | undefined {
  const { activePanel, previousCount, count, reviewChanges } = input;
  if (activePanel === 'changes' && previousCount > 0 && count === 0)
    return null;
  if (!reviewChanges) return undefined;
  if (previousCount === 0 && count > 0 && activePanel !== 'changes')
    return 'changes';
  return undefined;
}

/** Applies the pending-edit transition rule across renders. */
export function useReviewPanelPresentation(input: {
  activePanel: string | null;
  count: number;
  reviewChanges: boolean;
  setActivePanel: (panel: 'changes' | null) => void;
}): void {
  const { activePanel, count, reviewChanges, setActivePanel } = input;
  const previousCount = useRef(0);
  useEffect(() => {
    const next = nextActivePanel({
      activePanel,
      previousCount: previousCount.current,
      count,
      reviewChanges
    });
    previousCount.current = count;
    if (next !== undefined && next !== activePanel) setActivePanel(next);
  }, [activePanel, count, reviewChanges, setActivePanel]);
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SelectInstance } from 'react-select';

import { featheryWindow, isHoverDevice } from '../../../utils/browser';

import type { OptionData } from './types';
import useCollapsibleValues from './useCollapsibleValues';

type CollapseParams = {
  collapseSelectedPreference: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  disabled: boolean;
  values: OptionData[];
};

type CollapseControls = {
  collapseSelected: boolean;
  collapsedCount: number;
  computedMenuIsOpen: boolean | undefined;
  closeMenuImmediately: () => void;
  handleHoverEnter: () => void;
  handleHoverLeave: () => void;
  handleMenuClose: () => void;
  handleMenuOpen: () => void;
  handleWrapperMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleWrapperTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
  isMeasuring: boolean;
  rowHeight: number | null;
  selectRef: React.RefObject<SelectInstance<OptionData, true> | null>;
  closeHover: () => void;
  visibleCount: number;
};

export default function useDropdownCollapse({
  collapseSelectedPreference,
  containerRef,
  disabled,
  values
}: CollapseParams): CollapseControls {
  // Track the two expansion affordances: menu opened by click/tap and the temporary
  // hover expansion that reveals hidden values. They combine to determine whether we
  // should collapse chips in the main control.
  const [isMenuExpanded, setIsMenuExpanded] = useState(false);
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const selectRef = useRef<SelectInstance<OptionData, true> | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const pointerInsideRef = useRef(false);
  const ignoreNextMenuCloseRef = useRef(false);

  // Chips should only collapse when the feature is enabled _and_ neither expansion
  // mode is active. This mirrors the behaviour from the pre-refactor implementation.
  const collapseSelected = collapseSelectedPreference &&
    !(isMenuExpanded || isHoverExpanded);

  // useCollapsibleValues drives the measurement loop; we feed it the ordered values
  // so it can compute how many chips fit and expose the derived counts to consumers.
  const { collapsedCount, isMeasuring, rowHeight, visibleCount } =
    useCollapsibleValues(containerRef, values, collapseSelected);

  // React Select accepts a controlled `menuIsOpen`, but only when custom collapsing
  // is in play. In the default path we defer to the library.
  const computedMenuIsOpen = collapseSelectedPreference
    ? isMenuExpanded
    : undefined;

  // Hover expansion waits half a second before opening. We keep the timer reference
  // so we can cancel it whenever the pointer leaves or the menu state changes.
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    const win = featheryWindow();
    if (typeof win.clearTimeout === 'function') {
      win.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = null;
  }, []);

  const closeHover = useCallback(() => {
    pointerInsideRef.current = false;
    clearHoverTimer();
    setIsHoverExpanded(false);
  }, [clearHoverTimer]);

  const closeMenu = useCallback(() => {
    ignoreNextMenuCloseRef.current = false;
    closeHover();
    setIsMenuExpanded(false);
    const instance = selectRef.current as any;
    instance?.blur?.();
    instance?.closeMenu?.();
  }, [closeHover]);

  const handleHoverEnter = useCallback(() => {
    if (disabled || !collapseSelectedPreference || !isHoverDevice()) return;
    pointerInsideRef.current = true;
    if (isMenuExpanded || isHoverExpanded || hoverTimerRef.current !== null) {
      return;
    }

    const win = featheryWindow();
    if (typeof win.setTimeout !== 'function') {
      setIsHoverExpanded(true);
      return;
    }

    hoverTimerRef.current = win.setTimeout(() => {
      hoverTimerRef.current = null;
      if (
        !pointerInsideRef.current ||
        disabled ||
        !collapseSelectedPreference
      ) {
        return;
      }
      setIsHoverExpanded(true);
    }, 500) as unknown as number;
  }, [
    collapseSelectedPreference,
    disabled,
    isHoverExpanded,
    isMenuExpanded
  ]);

  const handleHoverLeave = useCallback(() => {
    if (!isHoverDevice()) return;
    pointerInsideRef.current = false;
    clearHoverTimer();
    if (!isMenuExpanded) {
      setIsHoverExpanded(false);
    }
  }, [clearHoverTimer, isMenuExpanded]);

  const openMenu = useCallback(() => {
    pointerInsideRef.current = true;
    ignoreNextMenuCloseRef.current = true;
    setIsMenuExpanded(true);
  }, []);

  const handleWrapperPointer = useCallback(
    (eventTarget: EventTarget | null) => {
      if (disabled || !collapseSelectedPreference) return;

      const elementTarget = eventTarget as HTMLElement | null;
      if (elementTarget?.closest('[data-feathery-multi-value="true"]')) {
        return;
      }

      // When the menu is already expanded, a click outside of an option should
      // collapse it instead of toggling immediately back to open.
      const optionTarget = (eventTarget as HTMLElement | null)?.closest(
        '[role="option"]'
      );

      if (isMenuExpanded) {
        if (!optionTarget) {
          closeMenu();
        }
        return;
      }

      openMenu();
    },
    [
      collapseSelectedPreference,
      closeMenu,
      disabled,
      isMenuExpanded,
      openMenu
    ]
  );

  const handleWrapperMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      handleWrapperPointer(event.target);
    },
    [handleWrapperPointer]
  );

  const handleWrapperTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      handleWrapperPointer(event.target);
    },
    [handleWrapperPointer]
  );

  const handleMenuOpen = useCallback(() => {
    if (!collapseSelectedPreference) return;
    ignoreNextMenuCloseRef.current = true;
    setIsMenuExpanded(true);
  }, [collapseSelectedPreference]);

  const handleMenuClose = useCallback(() => {
    if (!collapseSelectedPreference) return;
    if (ignoreNextMenuCloseRef.current) {
      ignoreNextMenuCloseRef.current = false;
      setIsMenuExpanded(true);
      return;
    }

    ignoreNextMenuCloseRef.current = false;
    closeMenu();
  }, [closeMenu, collapseSelectedPreference]);

  useEffect(() => {
    if (!collapseSelectedPreference) {
      pointerInsideRef.current = false;
      ignoreNextMenuCloseRef.current = false;
      clearHoverTimer();
      setIsHoverExpanded(false);
      setIsMenuExpanded(false);
      return;
    }

    // Close the menu when the user interacts outside the control; we listen in the
    // capture phase so React Select does not swallow the event first.
    const handlePointerDown = (event: PointerEvent) => {
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(event.target as Node)) return;
      closeMenu();
    };

    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;

    doc.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [
    clearHoverTimer,
    closeMenu,
    collapseSelectedPreference,
    containerRef
  ]);

  useEffect(() => {
    if (!disabled) return;
    closeHover();
  }, [closeHover, disabled]);

  return useMemo(
    () => ({
      collapseSelected,
      collapsedCount,
      computedMenuIsOpen,
      closeMenuImmediately: closeMenu,
      handleHoverEnter,
      handleHoverLeave,
      handleMenuClose,
      handleMenuOpen,
      handleWrapperMouseDown,
      handleWrapperTouchStart,
      isMeasuring,
      rowHeight,
      selectRef,
      closeHover,
      visibleCount
    }),
    [
      collapseSelected,
      collapsedCount,
      computedMenuIsOpen,
      closeMenu,
      handleHoverEnter,
      handleHoverLeave,
      handleMenuClose,
      handleMenuOpen,
      handleWrapperMouseDown,
      handleWrapperTouchStart,
      isMeasuring,
      rowHeight,
      closeHover,
      visibleCount,
      selectRef
    ]
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SelectInstance } from 'react-select';

import { featheryDoc } from '../../../utils/browser';

import type { OptionData } from './types';
import useCollapsibleValues from './useCollapsibleValues';

type CollapseParams = {
  collapseSelectedPreference: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  disabled: boolean;
  values: OptionData[];
};

type MenuCloseOptions = {
  skipBlur?: boolean;
};

type MenuControls = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  forceClose: (options?: MenuCloseOptions) => void;
};

type PointerControls = {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
  reset: () => void;
};

type MeasurementState = {
  isMeasuring: boolean;
  visibleCount: number;
};

type CollapseControls = {
  collapseSelected: boolean;
  collapsedCount: number;
  menu: MenuControls;
  pointer: PointerControls;
  measurement: MeasurementState;
  selectRef: React.RefObject<SelectInstance<OptionData, true> | null>;
};

export default function useDropdownCollapse({
  collapseSelectedPreference,
  containerRef,
  disabled,
  values
}: CollapseParams): CollapseControls {
  // Track whether the menu opened from user interaction so we can suspend collapsing while it is active.
  const [isMenuExpanded, setIsMenuExpanded] = useState(false);
  const selectRef = useRef<SelectInstance<OptionData, true> | null>(null);
  const pointerInsideRef = useRef(false);

  // Collapse only when enabled and no expansion path is active.
  const collapseSelected =
    collapseSelectedPreference && !isMenuExpanded;

  // useCollapsibleValues measures chip rows when collapsing is active.
  const { collapsedCount, isMeasuring, visibleCount } =
    useCollapsibleValues(containerRef, values, collapseSelected);

  const closeHover = useCallback(() => {
    pointerInsideRef.current = false;
  }, []);

  const closeMenu = useCallback(
    (options?: MenuCloseOptions) => {
      closeHover();
      setIsMenuExpanded(false);
      const instance = selectRef.current as any;
      if (!options?.skipBlur) {
        instance?.blur?.();
      }
      instance?.closeMenu?.();
    },
    [closeHover]
  );

  const handleWrapperPointer = useCallback(
    (eventTarget: EventTarget | null) => {
      if (disabled || !collapseSelectedPreference) return;

      const elementTarget = eventTarget as HTMLElement | null;
      if (
        elementTarget?.closest('[data-feathery-multi-value="true"]') ||
        elementTarget?.closest('[data-feathery-multi-value-remove="true"]')
      ) {
        return;
      }

      pointerInsideRef.current = true;
      const instance = selectRef.current as any;
      instance?.focus?.();
    },
    [collapseSelectedPreference, disabled]
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
    setIsMenuExpanded(true);
  }, [collapseSelectedPreference]);

  const handleMenuClose = useCallback(() => {
    if (!collapseSelectedPreference) return;
    setIsMenuExpanded(false);
    closeHover();
  }, [closeHover, collapseSelectedPreference]);

  useEffect(() => {
    if (!collapseSelectedPreference) {
      pointerInsideRef.current = false;
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

    const doc = featheryDoc();
    doc.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [closeMenu, collapseSelectedPreference, containerRef]);

  useEffect(() => {
    if (!disabled) return;
    closeHover();
  }, [closeHover, disabled]);

  return useMemo(
    () => ({
      collapseSelected,
      collapsedCount,
      menu: {
        isOpen: isMenuExpanded,
        open: handleMenuOpen,
        close: handleMenuClose,
        forceClose: closeMenu
      },
      pointer: {
        onMouseDown: handleWrapperMouseDown,
        onTouchStart: handleWrapperTouchStart,
        reset: closeHover
      },
      measurement: {
        isMeasuring,
        visibleCount
      },
      selectRef
    }),
    [
      collapseSelected,
      collapsedCount,
      closeHover,
      closeMenu,
      handleMenuClose,
      handleMenuOpen,
      handleWrapperMouseDown,
      handleWrapperTouchStart,
      isMenuExpanded,
      isMeasuring,
      visibleCount,
      selectRef
    ]
  );
}

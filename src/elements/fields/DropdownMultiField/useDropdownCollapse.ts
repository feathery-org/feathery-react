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

// Minimal control surface we need from react-select's instance
type SelectControls = {
  focus?: () => void;
  blur?: () => void;
  closeMenu?: () => void;
  openMenu?: (focusOption: 'first' | 'last') => void;
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

  // Collapse only when enabled and no expansion path is active.
  const collapseSelected = collapseSelectedPreference && !isMenuExpanded;

  // useCollapsibleValues measures chip rows when collapsing is active.
  const { collapsedCount, isMeasuring, visibleCount } = useCollapsibleValues(
    containerRef,
    values,
    collapseSelected
  );

  const closeMenu = useCallback((options?: MenuCloseOptions) => {
    setIsMenuExpanded(false);
    const instance = (selectRef.current as unknown as SelectControls) || null;
    if (!options?.skipBlur) {
      instance?.blur?.();
    }
    instance?.closeMenu?.();
  }, []);

  const handleWrapperPointer = useCallback(
    (eventTarget: EventTarget | null) => {
      if (disabled || !collapseSelectedPreference) return;

      const elementTarget = eventTarget as HTMLElement | null;
      if (
        elementTarget?.closest('[data-feathery-multi-value-remove="true"]')
      ) {
        return;
      }

      const instance = (selectRef.current as unknown as SelectControls) || null;
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
  }, [collapseSelectedPreference]);

  useEffect(() => {
    if (!collapseSelectedPreference) {
      setIsMenuExpanded(false);
      return;
    }

    // Close the menu on outside interactions; use capture so react-select's
    // internal handlers can't stop propagation first.
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

  // No hover state to reset; keep minimal surface.

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
        reset: () => {}
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

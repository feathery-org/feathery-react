import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SelectInstance } from 'react-select';

import { featheryDoc } from '../../../utils/browser';

import type { OptionData } from './types';
import useCollapsedValuesMeasurement from './useCollapsedValuesMeasurement';

type CollapseParams = {
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

/**
 * Manages the collapsed multi-select state and interactions.
 *
 * Coordinates value measurement, menu expansion state, and pointer
 * event handling for the collapsed selection UI. When enabled, shows
 * only chips that fit on one row plus a "+N" indicator.
 *
 * @param params - Collapse configuration and dependencies
 * @returns Collapse state, menu controls, pointer handlers, measurement data, and select ref
 */
export default function useCollapsedSelectionManager({
  containerRef,
  disabled,
  values
}: CollapseParams): CollapseControls {
  // Track whether the menu is expanded from user interaction
  const [isMenuExpanded, setIsMenuExpanded] = useState(false);
  const selectRef = useRef<SelectInstance<OptionData, true> | null>(null);

  // Collapse when menu is not expanded
  const collapseSelected = !isMenuExpanded;

  // Measure the visible chip window while collapse is active.
  const { collapsedCount, isMeasuring, visibleCount } =
    useCollapsedValuesMeasurement(containerRef, values, collapseSelected);

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
      if (disabled) return;

      const elementTarget = eventTarget as HTMLElement | null;
      if (elementTarget?.closest('[data-feathery-multi-value-remove="true"]')) {
        return;
      }

      const instance = (selectRef.current as unknown as SelectControls) || null;
      instance?.focus?.();
    },
    [disabled]
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
    setIsMenuExpanded(true);
  }, []);

  const handleMenuClose = useCallback(() => {
    setIsMenuExpanded(false);
  }, []);

  useEffect(() => {
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
  }, [closeMenu, containerRef]);

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

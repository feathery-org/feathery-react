import { useCallback, useEffect, useRef } from 'react';
import type { ActionMeta, OnChangeValue, SelectInstance } from 'react-select';
import { featheryDoc } from '../../../utils/browser';
import type { OptionData } from './types';

type SelectWithInternalState = SelectInstance<OptionData, true> & {
  state?: {
    focusedOption?: OptionData | null;
  };
};

type SelectInternalState = SelectWithInternalState['state'] & {
  inputValue?: string;
};

type CreatableOption = OptionData & { __isNew__?: boolean };

type EnterGuardDecision = 'allow' | 'block' | 'block-open';

const getLatestInputValue = (
  stateValue: unknown,
  inputRef: HTMLInputElement | null | undefined
) => {
  if (typeof stateValue === 'string') return stateValue;
  if (typeof inputRef?.value === 'string') return inputRef.value;
  return '';
};

interface UseDropdownInteractionsParams {
  // Core refs
  selectRef: React.RefObject<SelectInstance<OptionData, true> | null>;
  containerRef: React.RefObject<HTMLElement | null>;

  // State
  disabled: boolean;
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;

  // Collapse controls from manager
  openCollapseMenu: () => void;
  closeCollapseMenu: () => void;
  forceCloseCollapseMenu: (options?: { skipBlur?: boolean }) => void;
  focusOnMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  focusOnTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;

  // Selection data
  selectVal: OptionData[];
  options: OptionData[];
  isCreatableInputValid?: (inputValue: string) => boolean;

  // Options config
  create: boolean;
  disableAllOptions: boolean;

  // Parent callbacks
  onChange: (selected: any, actionMeta: any) => void;
}

interface UseDropdownInteractionsReturn {
  // Wrapper handlers
  handleWrapperMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleWrapperTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
  handleKeyDownCapture: (event: React.KeyboardEvent) => void;

  // Select component handlers
  handleChange: (
    selected: OnChangeValue<OptionData, true>,
    actionMeta: ActionMeta<OptionData>
  ) => void;
  handleSelectKeyDown: (event: React.KeyboardEvent) => void;
  handleMenuOpen: () => void;
  handleMenuClose: () => void;

  // Collapse-specific handlers
  handleControlPress: (
    event: React.SyntheticEvent,
    options: { isTouch: boolean }
  ) => boolean;
  handleCollapsedChipPress: (event: React.SyntheticEvent) => void;
  extendCloseSuppression: () => void;
}

/**
 * Manages all user interactions for the dropdown: keyboard, mouse, touch, and menu.
 *
 * Handles Enter key validation, collapse menu interactions, selection changes,
 * and outside click detection. Prevents form submission when appropriate and
 * coordinates menu state across collapsed and expanded modes.
 */
export default function useDropdownInteractions({
  selectRef,
  containerRef,
  disabled,
  isMenuOpen,
  setIsMenuOpen,
  openCollapseMenu,
  closeCollapseMenu,
  forceCloseCollapseMenu,
  focusOnMouseDown,
  focusOnTouchStart,
  selectVal,
  options,
  isCreatableInputValid,
  create,
  disableAllOptions,
  onChange
}: UseDropdownInteractionsParams): UseDropdownInteractionsReturn {
  // Handle React Select quirks where touch-initiated opens can trigger
  // immediate closes if we don't suppress the close event for a short time.
  const suppressCloseUntilRef = useRef<number>(0);

  const extendCloseSuppression = useCallback(() => {
    suppressCloseUntilRef.current = performance.now() + 250;
  }, []);

  const syncSelectInstance = useCallback(
    () => selectRef.current as SelectWithInternalState | null,
    [selectRef]
  );

  const openMenu = useCallback(() => {
    const instance = syncSelectInstance();
    if (!instance) return;

    extendCloseSuppression();
    setIsMenuOpen(true);
    openCollapseMenu();
    instance.focus?.();
    instance.openMenu?.('first');
  }, [
    extendCloseSuppression,
    openCollapseMenu,
    setIsMenuOpen,
    syncSelectInstance
  ]);

  const closeMenuImmediately = useCallback(
    (options?: Parameters<typeof forceCloseCollapseMenu>[0]) => {
      setIsMenuOpen(false);
      closeCollapseMenu();
      forceCloseCollapseMenu(options);
    },
    [closeCollapseMenu, forceCloseCollapseMenu, setIsMenuOpen]
  );

  const handleMenuOpen = useCallback(() => {
    setIsMenuOpen(true);
    openCollapseMenu();
    syncSelectInstance();
  }, [openCollapseMenu, setIsMenuOpen, syncSelectInstance]);

  const handleMenuClose = useCallback(() => {
    if (performance.now() < suppressCloseUntilRef.current) {
      return;
    }
    setIsMenuOpen(false);
    closeCollapseMenu();
  }, [closeCollapseMenu, setIsMenuOpen]);

  // Tries to open the menu when collapsed. Returns true if menu was opened.
  const tryOpenCollapsedMenu = useCallback(
    (eventTarget: EventTarget | null) => {
      if (isMenuOpen) return false;

      const elementTarget = eventTarget as HTMLElement | null;
      if (elementTarget?.closest('[data-feathery-multi-value-remove="true"]')) {
        return false;
      }

      openMenu();
      return true;
    },
    [isMenuOpen, openMenu]
  );

  const handleWrapperMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (tryOpenCollapsedMenu(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      focusOnMouseDown(event);
    },
    [focusOnMouseDown, tryOpenCollapsedMenu]
  );

  const handleWrapperTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (tryOpenCollapsedMenu(event.target)) {
        event.stopPropagation();
        return;
      }

      focusOnTouchStart(event);
    },
    [focusOnTouchStart, tryOpenCollapsedMenu]
  );

  const handleControlPress = useCallback(
    (event: React.SyntheticEvent, { isTouch }: { isTouch: boolean }) => {
      if (!tryOpenCollapsedMenu(event.currentTarget)) return false;

      if (!isTouch && 'preventDefault' in event) {
        event.preventDefault();
      }
      event.stopPropagation();
      return true;
    },
    [tryOpenCollapsedMenu]
  );

  const handleCollapsedChipPress = useCallback(
    (event: React.SyntheticEvent) => {
      if (!tryOpenCollapsedMenu(event.currentTarget)) return;

      event.stopPropagation();
    },
    [tryOpenCollapsedMenu]
  );

  const handleChange = useCallback(
    (
      selected: OnChangeValue<OptionData, true>,
      actionMeta: ActionMeta<OptionData>
    ) => {
      if (
        actionMeta.action === 'remove-value' ||
        actionMeta.action === 'pop-value'
      ) {
        extendCloseSuppression();
      }
      const skipBlurAction =
        actionMeta.action === 'remove-value' ||
        actionMeta.action === 'pop-value' ||
        actionMeta.action === 'select-option' ||
        actionMeta.action === 'create-option';

      if (!skipBlurAction || !isMenuOpen) {
        closeMenuImmediately(skipBlurAction ? { skipBlur: true } : undefined);
      }

      onChange(selected, actionMeta);
      selectRef.current?.focus?.();
    },
    [
      closeMenuImmediately,
      extendCloseSuppression,
      isMenuOpen,
      onChange,
      selectRef
    ]
  );

  // Evaluates whether Enter key should submit, open menu, or be blocked.
  const evaluateEnterGuard = useCallback((): EnterGuardDecision => {
    const instance = selectRef.current as SelectWithInternalState | null;
    const selectState = instance?.state as SelectInternalState | undefined;
    const rawFocusedOption = selectState?.focusedOption as
      | CreatableOption
      | undefined;
    const focusedOption = rawFocusedOption ?? null;
    const focusedValue = focusedOption?.value;
    const hasFocusedOption = Boolean(focusedValue);
    const isCreateFocused = Boolean(create && focusedOption?.__isNew__);
    // React Select defers state updates during keydown; fall back to the live
    // input element so creatable text is visible before the state commit.
    const rawInputValue = getLatestInputValue(
      selectState?.inputValue,
      instance?.inputRef ?? null
    );
    const inputValue = rawInputValue.trim();
    const hasInput = inputValue.length > 0;
    const normalizedInput = inputValue.toLowerCase();
    const matchesExistingOption =
      hasInput &&
      options.some(
        (option) => option?.value?.toLowerCase() === normalizedInput
      );
    const matchesSelectedValue =
      hasInput &&
      selectVal.some(
        (option) => option?.value?.toLowerCase() === normalizedInput
      );
    const canCreateOption =
      create &&
      hasInput &&
      (isCreatableInputValid
        ? isCreatableInputValid(inputValue)
        : !matchesExistingOption && !matchesSelectedValue);
    const normalizedFocusedValue = focusedValue?.toLowerCase();
    const isFocusedSelected = Boolean(
      normalizedFocusedValue &&
        selectVal.some(
          (option) => option?.value?.toLowerCase() === normalizedFocusedValue
        )
    );

    if (!isMenuOpen) {
      return 'block-open';
    }

    if (canCreateOption) {
      return 'allow';
    }

    if (isCreateFocused) {
      return 'block';
    }

    if (hasFocusedOption) {
      return isFocusedSelected ? 'block' : 'allow';
    }

    if (disableAllOptions) {
      return 'block';
    }

    if (matchesExistingOption || matchesSelectedValue) {
      return 'block';
    }

    // No option focused and no creatable input to act on—block to preserve the
    // form submit guard.
    return 'block';
  }, [
    create,
    disableAllOptions,
    isMenuOpen,
    isCreatableInputValid,
    options,
    selectVal,
    selectRef
  ]);

  const processEnterKey = useCallback(
    (event: React.KeyboardEvent) => {
      const decision = evaluateEnterGuard();
      if (decision === 'allow') return decision;

      if (!event.defaultPrevented) {
        event.preventDefault();
      }
      if (!event.isPropagationStopped()) {
        event.stopPropagation();
      }

      if (decision === 'block-open') {
        const instance = selectRef.current as SelectWithInternalState | null;
        instance?.openMenu?.('first');
      }

      return decision;
    },
    [evaluateEnterGuard, selectRef]
  );

  const handleSelectKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' || disabled) return;
      processEnterKey(event);
    },
    [disabled, processEnterKey]
  );

  // Capture the keydown before it reaches the native form submit handler. This
  // keeps Enter from bubbling out when React Select bails early (e.g., no
  // creatable input or all options selected).
  // Also clears close suppression for Escape to allow immediate user-initiated closes.
  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return;

      // Clear suppression for Escape so React Select can close immediately
      if (event.key === 'Escape') {
        suppressCloseUntilRef.current = 0;
        return;
      }

      if (event.key === 'Enter') {
        processEnterKey(event);
      }
    },
    [disabled, processEnterKey]
  );

  // Close menu when clicking outside the container
  useEffect(() => {
    if (!isMenuOpen) return;

    const doc = featheryDoc();

    const handlePointerDown = (event: PointerEvent) => {
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(event.target as Node)) return;
      closeMenuImmediately();
    };

    doc.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [closeMenuImmediately, containerRef, isMenuOpen]);

  return {
    handleWrapperMouseDown,
    handleWrapperTouchStart,
    handleKeyDownCapture,
    handleChange,
    handleSelectKeyDown,
    handleMenuOpen,
    handleMenuClose,
    handleControlPress,
    handleCollapsedChipPress,
    extendCloseSuppression
  };
}

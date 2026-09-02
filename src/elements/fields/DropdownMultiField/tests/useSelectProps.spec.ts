import React from 'react';
import { renderHook } from '@testing-library/react';
import useSelectProps from '../useSelectProps';
import type { OptionData } from '../types';
import type { SelectInstance } from 'react-select';

const createParams = (overrides: Record<string, any> = {}) => ({
  selectRef: React.createRef<SelectInstance<OptionData, boolean>>(),
  containerRef: React.createRef<HTMLElement>(),
  servar: { key: 'test-key', max_length: null },
  selectVal: [] as OptionData[],
  options: [{ value: 'a', label: 'A' }] as OptionData[],
  required: false,
  disabled: false,
  isMenuOpen: false,
  loadingDynamicOptions: false,
  isSingleSelectMode: false,
  selectStyles: {},
  selectComponentsOverride: {},
  collapseSelected: false,
  visibleCount: 1,
  collapsedCount: 0,
  isMeasuring: false,
  shouldHideInput: false,
  handleChange: jest.fn(),
  setFocused: jest.fn(),
  handleSelectKeyDown: jest.fn(),
  handleMenuOpen: jest.fn(),
  handleMenuClose: jest.fn(),
  extendCloseSuppression: jest.fn(),
  create: false,
  ...overrides
});

describe('useSelectProps', () => {
  // Regression guard for the menu overflowing the page: react-select's default
  // menuPlacement of 'bottom' grows the scrollable area and scrolls to the menu
  // when there is no room below, instead of flipping above the control.
  // jsdom cannot exercise the real placement maths (its offsetParent is always
  // null, so getMenuPlacement bails to its defaults), so assert on the prop.
  describe('menu placement', () => {
    it('asks react-select to flip the menu rather than grow the page', () => {
      const { result } = renderHook(() => useSelectProps(createParams()));

      expect(result.current.menuPlacement).toBe('auto');
    });

    it('flips in single-select mode too', () => {
      const { result } = renderHook(() =>
        useSelectProps(
          createParams({
            isSingleSelectMode: true,
            servar: { key: 'test-key', max_length: 1 }
          })
        )
      );

      expect(result.current.menuPlacement).toBe('auto');
    });

    it('leaves the menu inline so the outside-click handlers still see it', () => {
      const { result } = renderHook(() => useSelectProps(createParams()));

      // Both outside-click handlers test containment against containerRef, so a
      // body-portaled menu would close the menu before an option click landed.
      expect(result.current).not.toHaveProperty('menuPortalTarget');
    });
  });
});

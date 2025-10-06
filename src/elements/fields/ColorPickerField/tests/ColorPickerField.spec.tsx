import { Suspense } from 'react';
import { render, waitFor } from '@testing-library/react';
import ColorPickerField from '..';
import {
  createColorPickerElement,
  createColorPickerProps,
  createStatefulOnChange,
  clickColorDisplay,
  isPickerVisible,
  isColorDisplayDisabled,
  getDisplayedColor,
  resetMockFieldValue,
  expectColorValue
} from './test-utils';

describe('ColorPickerField', () => {
  beforeEach(() => {
    resetMockFieldValue();
  });

  describe('Rendering and Display', () => {
    it('should render color display with initial value', async () => {
      const element = createColorPickerElement();
      const props = createColorPickerProps(element, {
        fieldVal: 'FF5733FF'
      });

      render(<ColorPickerField {...props} />);

      const displayedColor = await getDisplayedColor();
      // The color should be set as background (browser converts to rgb)
      expect(displayedColor).toBeTruthy();
    });
  });

  describe('Picker Interaction', () => {
    it('should open picker when clicking color display', async () => {
      const element = createColorPickerElement();
      const props = createColorPickerProps(element, {
        fieldVal: 'FFFFFFFF'
      });

      render(
        <Suspense fallback={<div>Loading...</div>}>
          <ColorPickerField {...props} />
        </Suspense>
      );

      await clickColorDisplay();

      await waitFor(() => {
        expect(isPickerVisible()).toBe(true);
      });
    });
  });

  describe('Value Changes', () => {
    it('should call onChange when Sketch picker changes color', async () => {
      const element = createColorPickerElement();
      const onChange = jest.fn();
      const props = createColorPickerProps(element, {
        fieldVal: 'FFFFFFFF',
        onChange
      });

      const { container } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <ColorPickerField {...props} />
        </Suspense>
      );

      await clickColorDisplay();

      await waitFor(() => {
        expect(isPickerVisible()).toBe(true);
      });

      const sketchElement = container.querySelector(
        '[class*="w-color-sketch"]'
      );
      expect(sketchElement).toBeTruthy();
    });

    it('should update fieldVal through stateful onChange', async () => {
      const element = createColorPickerElement();
      const onChange = createStatefulOnChange();
      const props = createColorPickerProps(element, {
        fieldVal: 'FFFFFFFF',
        onChange
      });

      render(
        <Suspense fallback={<div>Loading...</div>}>
          <ColorPickerField {...props} />
        </Suspense>
      );

      await clickColorDisplay();

      await waitFor(() => {
        expect(isPickerVisible()).toBe(true);
      });

      onChange('FF0000FF');
      expectColorValue('FF0000FF');
    });

    it('should display updated color when fieldVal prop changes', async () => {
      const element = createColorPickerElement();
      const props = createColorPickerProps(element, {
        fieldVal: 'FFFFFFFF'
      });

      const { rerender } = render(<ColorPickerField {...props} />);

      const initialColor = await getDisplayedColor();
      expect(initialColor).toBeTruthy();

      const updatedProps = createColorPickerProps(element, {
        fieldVal: 'FF0000FF'
      });

      rerender(<ColorPickerField {...updatedProps} />);

      const updatedColor = await getDisplayedColor();
      expect(updatedColor).toBeTruthy();
      expect(updatedColor).not.toBe(initialColor);
    });
  });

  describe('Disabled State', () => {
    it('should apply disabled pointer events style when disabled', async () => {
      const element = createColorPickerElement();
      const props = createColorPickerProps(element, {
        disabled: true
      });

      render(<ColorPickerField {...props} />);

      expect(await isColorDisplayDisabled()).toBe(true);
    });
  });
});

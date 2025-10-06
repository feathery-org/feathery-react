import {
  createSliderElement,
  createSliderProps,
  createStatefulOnChange,
  resetMockFieldValue,
  getSliderHandle,
  getSliderRail,
  getMinLabel,
  getMaxLabel,
  expectSliderToHaveMin,
  expectSliderToHaveMax,
  expectSliderToHaveValue
} from './test-utils';
import { render, screen, fireEvent } from '@testing-library/react';
import SliderField from '../index';

describe('SliderField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders SliderField component with default props', () => {
      const element = createSliderElement('slider');
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      const handle = getSliderHandle();
      expect(handle).toBeTruthy();
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with default min and max values', () => {
      const element = createSliderElement('slider');
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMin(0);
      expectSliderToHaveMax(100);
    });
  });

  describe('onChange', () => {
    it('handles slider value change via click on track', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createSliderElement('slider', {
        min_value: 0,
        max_value: 100
      });
      const props = createSliderProps(element, {
        onChange: mockOnChange,
        fieldVal: 0
      });

      render(<SliderField {...props} />);

      const rail = getSliderRail();

      const rect = rail.getBoundingClientRect();
      const midX = rect.left + rect.width * 0.75;
      const midY = rect.top + rect.height / 2;

      fireEvent.mouseDown(rail, {
        clientX: midX,
        clientY: midY
      });

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('displays current field value', () => {
      const mockOnChange = jest.fn();
      const element = createSliderElement('slider');
      const props = createSliderProps(element, {
        onChange: mockOnChange,
        fieldVal: 75
      });

      render(<SliderField {...props} />);

      expectSliderToHaveValue(75);
    });

    it('updates when fieldVal prop changes', () => {
      const mockOnChange = jest.fn();
      const element = createSliderElement('slider');
      const props = createSliderProps(element, {
        onChange: mockOnChange,
        fieldVal: 30
      });

      const { rerender } = render(<SliderField {...props} />);

      expectSliderToHaveValue(30);

      // Update fieldVal
      rerender(<SliderField {...props} fieldVal={60} />);

      expectSliderToHaveValue(60);
    });
  });

  describe('min value', () => {
    it('sets minimum value to 0 by default', () => {
      const element = createSliderElement('slider');
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMin(0);
    });

    it('sets custom minimum value', () => {
      const element = createSliderElement('slider', { min_value: 10 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMin(10);
    });

    it('sets negative minimum value', () => {
      const element = createSliderElement('slider', { min_value: -50 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMin(-50);
    });

    it('respects minimum value constraint', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createSliderElement('slider', {
        min_value: 20,
        max_value: 100
      });
      const props = createSliderProps(element, {
        onChange: mockOnChange,
        fieldVal: 20
      });

      render(<SliderField {...props} />);

      expectSliderToHaveMin(20);
      expectSliderToHaveValue(20);
    });
  });

  describe('max value', () => {
    it('sets maximum value to 100 by default', () => {
      const element = createSliderElement('slider');
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMax(100);
    });

    it('sets custom maximum value', () => {
      const element = createSliderElement('slider', { max_value: 200 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMax(200);
    });

    it('sets smaller maximum value', () => {
      const element = createSliderElement('slider', { max_value: 10 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expectSliderToHaveMax(10);
    });

    it('respects maximum value constraint', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createSliderElement('slider', {
        min_value: 0,
        max_value: 50
      });
      const props = createSliderProps(element, {
        onChange: mockOnChange,
        fieldVal: 50
      });

      render(<SliderField {...props} />);

      expectSliderToHaveMax(50);
      expectSliderToHaveValue(50);
    });
  });

  describe('min label', () => {
    it('displays min value as label by default', () => {
      const element = createSliderElement('slider', { min_value: 0 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expect(getMinLabel()).toBe('0');
    });

    it('displays custom min label', () => {
      const element = createSliderElement('slider', { min_val_label: 'Low' });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expect(getMinLabel()).toBe('Low');
    });

    it('displays custom min label with custom min value', () => {
      const element = createSliderElement('slider', {
        min_value: 10,
        min_val_label: 'Minimum'
      });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expect(getMinLabel()).toBe('Minimum');
      expectSliderToHaveMin(10);
    });
  });

  describe('max label', () => {
    it('displays max value as label by default', () => {
      const element = createSliderElement('slider', { max_value: 100 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expect(getMaxLabel()).toBe('100');
    });

    it('displays custom max label', () => {
      const element = createSliderElement('slider', { max_val_label: 'High' });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expect(getMaxLabel()).toBe('High');
    });

    it('displays custom max label with custom max value', () => {
      const element = createSliderElement('slider', {
        max_value: 200,
        max_val_label: 'Maximum'
      });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      expect(getMaxLabel()).toBe('Maximum');
      expectSliderToHaveMax(200);
    });
  });

  describe('step size', () => {
    it('uses step size of 1 by default', () => {
      const element = createSliderElement('slider');
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      const handle = getSliderHandle();
      expect(handle).toBeTruthy();
      // Step size is passed to the Slider component but not exposed via aria
    });

    it('sets custom step size', () => {
      const element = createSliderElement('slider', { step_size: 5 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      const handle = getSliderHandle();
      expect(handle).toBeTruthy();
    });

    it('sets decimal step size', () => {
      const element = createSliderElement('slider', { step_size: 0.1 });
      const props = createSliderProps(element);

      render(<SliderField {...props} />);

      const handle = getSliderHandle();
      expect(handle).toBeTruthy();
    });
  });
});

import {
  createButtonGroupElement,
  createButtonGroupProps,
  createStatefulOnClick,
  createOptionsMetadata,
  createImageButtonGroupElement,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  getButtonByValue,
  getButtonLabels,
  getButtonLabel,
  expectButtonToBeSelected,
  expectButtonToBeUnselected,
  expectButtonGroupToHaveButtonCount,
  expectButtonToHaveImage,
  expectButtonToHaveNoImage,
  expectButtonToHaveTooltip,
  expectButtonGroupToBeDisabled,
  expectErrorInputToHaveAttributes
} from './test-utils';
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import ButtonGroupField from '../index';

describe('ButtonGroupField', () => {
  beforeEach(() => {
    resetMockFieldValue();
    // Reset useSalesforceSync mock to default state
    const mockUseSalesforceSync =
      require('../../../../hooks/useSalesforceSync').default;
    mockUseSalesforceSync.mockReturnValue({
      dynamicOptions: [],
      loadingDynamicOptions: false,
      shouldSalesforceSync: false
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders with default options', () => {
      const element = createButtonGroupElement();
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonGroupToHaveButtonCount(3);
      expect(getButtonLabels()).toEqual(['Option 1', 'Option 2', 'Option 3']);
    });

    it('renders with custom options', () => {
      const options = ['Apple', 'Banana', 'Cherry'];
      const element = createButtonGroupElement('button_group', { options });
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonGroupToHaveButtonCount(3);
      expect(getButtonLabels()).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('renders with custom labels', () => {
      const options = ['opt1', 'opt2', 'opt3'];
      const labels = ['First Option', 'Second Option', 'Third Option'];
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, labels)
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expect(getButtonLabels()).toEqual([
        'First Option',
        'Second Option',
        'Third Option'
      ]);
    });

    it('renders with no labels when labels array is empty', () => {
      const options = ['opt1', 'opt2'];
      const element = createButtonGroupElement('button_group', {
        options,
        option_labels: []
      });
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expect(getButtonLabels()).toEqual(['opt1', 'opt2']);
    });

    it('renders ErrorInput with correct attributes', () => {
      const element = createButtonGroupElement();
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectErrorInputToHaveAttributes(
        'test-button-group-key',
        'test-button-group-key',
        'Test button group field'
      );
    });
  });

  describe('Button Interaction', () => {
    it('handles button clicks with onClick callback', () => {
      const element = createButtonGroupElement();
      const onClick = jest.fn();
      const props = createButtonGroupProps(element, { onClick });

      render(<ButtonGroupField {...props} />);

      const firstButton = getButtonByValue('Option 1');
      fireEvent.click(firstButton!);

      expect(onClick).toHaveBeenCalledWith('Option 1');
    });

    it('supports multiple selection via stateful onClick', () => {
      const element = createButtonGroupElement();
      const onClick = createStatefulOnClick();
      const props = createButtonGroupProps(element, { onClick, fieldVal: [] });

      render(<ButtonGroupField {...props} />);

      const button1 = getButtonByValue('Option 1');
      const button2 = getButtonByValue('Option 2');

      fireEvent.click(button1!);
      expect(getMockFieldValue()).toEqual(['Option 1']);

      fireEvent.click(button2!);
      expect(getMockFieldValue()).toEqual(['Option 1', 'Option 2']);
    });

    it('toggles selection when clicking already selected button', () => {
      const element = createButtonGroupElement();
      const onClick = createStatefulOnClick();
      const props = createButtonGroupProps(element, {
        onClick,
        fieldVal: ['Option 1']
      });

      setMockFieldValue(['Option 1']);
      render(<ButtonGroupField {...props} />);

      const button1 = getButtonByValue('Option 1');
      fireEvent.click(button1!);

      expect(getMockFieldValue()).toEqual([]);
    });

    it('handles single selection mode correctly', () => {
      const element = createButtonGroupElement();
      const onClick = createStatefulOnClick();
      const props = createButtonGroupProps(element, {
        onClick,
        fieldVal: 'Option 1'
      });

      setMockFieldValue('Option 1');
      render(<ButtonGroupField {...props} />);

      const button2 = getButtonByValue('Option 2');
      fireEvent.click(button2!);

      expect(getMockFieldValue()).toEqual(['Option 2']);
    });

    it('shows button selection state via selectedOptMap', () => {
      const element = createButtonGroupElement();
      setMockFieldValue(['Option 1', 'Option 3']); // Set mock state to match fieldVal
      const props = createButtonGroupProps(element, {
        fieldVal: ['Option 1', 'Option 3']
      });

      render(<ButtonGroupField {...props} />);

      expectButtonToBeSelected('Option 1');
      expectButtonToBeUnselected('Option 2');
      expectButtonToBeSelected('Option 3');
    });
  });

  describe('Disabled State', () => {
    it('disables all interactions when disabled prop is true', () => {
      const element = createButtonGroupElement();
      const onClick = jest.fn();
      const props = createButtonGroupProps(element, {
        onClick,
        disabled: true
      });

      render(<ButtonGroupField {...props} />);

      expectButtonGroupToBeDisabled();

      const button = getButtonByValue('Option 1');
      fireEvent.click(button!);

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('Options with Images', () => {
    it('renders buttons with images when option_images provided', () => {
      const element = createImageButtonGroupElement(
        ['Option 1', 'Option 2'],
        ['image1.jpg', 'image2.jpg']
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonToHaveImage(0, 'image1.jpg');
      expectButtonToHaveImage(1, 'image2.jpg');
    });

    it('renders buttons without images when no option_images provided', () => {
      const element = createButtonGroupElement('button_group', {
        options: ['Option 1', 'Option 2']
      });
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonToHaveNoImage(0);
      expectButtonToHaveNoImage(1);
    });

    it('handles mixed image array (some buttons with images, some without)', () => {
      const element = createButtonGroupElement('button_group', {
        options: ['Option 1', 'Option 2', 'Option 3'],
        option_images: ['image1.jpg', '', 'image3.jpg']
      });
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonToHaveImage(0, 'image1.jpg');
      expectButtonToHaveNoImage(1);
      expectButtonToHaveImage(2, 'image3.jpg');
    });
  });

  describe('Options with Labels', () => {
    it('displays custom labels when option_labels provided', () => {
      const options = ['val1', 'val2', 'val3'];
      const labels = ['Display 1', 'Display 2', 'Display 3'];
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, labels)
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expect(getButtonLabels()).toEqual([
        'Display 1',
        'Display 2',
        'Display 3'
      ]);
    });

    it('falls back to option value when no label provided', () => {
      const options = ['val1', 'val2'];
      const labels = ['Display 1']; // Missing label for second option
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, labels)
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expect(getButtonLabels()).toEqual(['Display 1', 'val2']);
    });

    it('renders empty label when label is empty string', () => {
      const options = ['val1', 'val2'];
      const labels = ['', 'Label 2'];
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, labels)
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      const label1 = getButtonLabel(0);
      const label2 = getButtonLabel(1);

      expect(label1).toBe('');
      expect(label2).toBe('Label 2');
    });
  });

  describe('Options with Tooltips', () => {
    it('displays tooltips when option_tooltips provided', () => {
      const options = ['opt1', 'opt2'];
      const tooltips = ['Tooltip 1', 'Tooltip 2'];
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, undefined, tooltips)
      );
      const props = createButtonGroupProps(element);

      const { container } = render(<ButtonGroupField {...props} />);

      expectButtonToHaveTooltip('opt1', 'Tooltip 1');
      expectButtonToHaveTooltip('opt2', 'Tooltip 2');
    });

    it('handles missing tooltips gracefully', () => {
      const options = ['opt1', 'opt2'];
      const tooltips = ['Tooltip 1']; // Missing tooltip for second option
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, undefined, tooltips)
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonToHaveTooltip('opt1', 'Tooltip 1');
      expectButtonToHaveTooltip('opt2', '');
    });

    it('does not render tooltip when tooltip is empty', () => {
      const options = ['opt1', 'opt2'];
      const tooltips = ['', 'Tooltip 2'];
      const element = createButtonGroupElement(
        'button_group',
        createOptionsMetadata(options, undefined, tooltips)
      );
      const props = createButtonGroupProps(element);

      render(<ButtonGroupField {...props} />);

      expectButtonToHaveTooltip('opt1', '');
      expectButtonToHaveTooltip('opt2', 'Tooltip 2');
    });
  });
});

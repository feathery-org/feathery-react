import './test-utils';
import React, { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TextAutocomplete from '../TextAutocomplete';

const mockResponsiveStyles = {
  getTarget: jest.fn(() => ({}))
};

function TestWrapper({ children, ...props }: any) {
  const listItemRef = useRef<any[]>([]);

  return (
    <div>
      <TextAutocomplete
        listItemRef={listItemRef}
        responsiveStyles={mockResponsiveStyles}
        {...props}
      >
        {children}
      </TextAutocomplete>
    </div>
  );
}

jest.mock('../../../components/Overlay', () => {
  return function MockOverlay({ show, children }: any) {
    if (!show) return null;
    return <div data-testid='overlay'>{children}</div>;
  };
});

describe('TextAutocomplete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders children when no options are provided', () => {
      render(
        <TestWrapper allOptions={[]}>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByLabelText('test input')).toBeInTheDocument();
    });

    it('renders children with OverlayTrigger when options are provided', () => {
      render(
        <TestWrapper allOptions={['Option 1', 'Option 2']}>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByLabelText('test input')).toBeInTheDocument();
    });
  });

  describe('Option Filtering', () => {
    const options = ['Apple', 'Banana', 'Cherry', 'Date'];

    it('shows all options when value is empty and showOptions is true', () => {
      render(
        <TestWrapper allOptions={options} value='' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.getByText('Banana')).toBeInTheDocument();
      expect(screen.getByText('Cherry')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    it('filters options based on input value', () => {
      render(
        <TestWrapper allOptions={options} value='a' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.getByText('Banana')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();

      expect(screen.queryByText('Cherry')).not.toBeInTheDocument();
    });

    it('performs case-insensitive filtering', () => {
      render(
        <TestWrapper allOptions={options} value='APPLE' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.queryByText('Banana')).not.toBeInTheDocument();
    });

    it('shows no options when value matches nothing', () => {
      render(
        <TestWrapper allOptions={options} value='xyz' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.queryByText('Apple')).not.toBeInTheDocument();
      expect(screen.queryByText('Banana')).not.toBeInTheDocument();
      expect(screen.queryByText('Cherry')).not.toBeInTheDocument();
      expect(screen.queryByText('Date')).not.toBeInTheDocument();
    });
  });

  describe('Option Selection', () => {
    it('calls onSelect when option is clicked', () => {
      const mockOnSelect = jest.fn();

      render(
        <TestWrapper
          allOptions={['Apple', 'Banana']}
          value=''
          showOptions
          onSelect={mockOnSelect}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const appleOption = screen.getByText('Apple');
      fireEvent.click(appleOption);

      expect(mockOnSelect).toHaveBeenCalledWith('Apple');
      expect(mockOnSelect).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect when Enter key is pressed on option', () => {
      const mockOnSelect = jest.fn();

      render(
        <TestWrapper
          allOptions={['Apple', 'Banana']}
          value=''
          showOptions
          onSelect={mockOnSelect}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const appleOption = screen.getByText('Apple');
      fireEvent.keyDown(appleOption, { key: 'Enter' });

      expect(mockOnSelect).toHaveBeenCalledWith('Apple');
      expect(mockOnSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Keyboard Navigation', () => {
    it('calls onInputFocus when ArrowUp is pressed on first option', () => {
      const mockOnInputFocus = jest.fn();

      render(
        <TestWrapper
          allOptions={['Apple', 'Banana']}
          value=''
          showOptions
          onInputFocus={mockOnInputFocus}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );
      const firstOption = screen.getByText('Apple');

      fireEvent.keyDown(firstOption, { key: 'ArrowUp' });

      expect(mockOnInputFocus).toHaveBeenCalledTimes(1);
    });

    it('calls onInputFocus when ArrowLeft is pressed on first option', () => {
      const mockOnInputFocus = jest.fn();

      render(
        <TestWrapper
          allOptions={['Apple', 'Banana']}
          value=''
          showOptions
          onInputFocus={mockOnInputFocus}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const firstOption = screen.getByText('Apple');
      fireEvent.keyDown(firstOption, { key: 'ArrowLeft' });

      expect(mockOnInputFocus).toHaveBeenCalledTimes(1);
    });

    it('handles ArrowDown navigation between options', () => {
      render(
        <TestWrapper
          allOptions={['Apple', 'Banana', 'Cherry']}
          value=''
          showOptions
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const firstOption = screen.getByText('Apple');

      fireEvent.keyDown(firstOption, { key: 'ArrowDown' });

      const secondOption = screen.getByText('Banana');

      expect(secondOption).toHaveFocus();
    });

    it('focuses previous sibling when ArrowUp is pressed on non-first option', () => {
      render(
        <TestWrapper
          allOptions={['Apple', 'Banana', 'Cherry']}
          value=''
          showOptions
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const secondOption = screen.getByText('Banana');
      fireEvent.keyDown(secondOption, { key: 'ArrowUp' });

      expect(screen.getByText('Apple')).toHaveFocus();
    });

    it('focuses previous sibling when ArrowLeft is pressed on non-first option', () => {
      render(
        <TestWrapper
          allOptions={['Apple', 'Banana', 'Cherry']}
          value=''
          showOptions
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const thirdOption = screen.getByText('Cherry');
      fireEvent.keyDown(thirdOption, { key: 'ArrowLeft' });

      expect(screen.getByText('Banana')).toHaveFocus();
    });
  });

  describe('Blur Behavior', () => {
    it('calls onHide when option loses focus to non-option element', () => {
      const mockOnHide = jest.fn();

      render(
        <TestWrapper
          allOptions={['Apple', 'Banana']}
          value=''
          showOptions
          onHide={mockOnHide}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const appleOption = screen.getByText('Apple');

      // Simulate blur event with relatedTarget being null (focus lost to nothing)
      fireEvent.blur(appleOption, { relatedTarget: null });

      expect(mockOnHide).toHaveBeenCalledTimes(1);
    });
  });

  describe('Visibility Control', () => {
    it('does not show options when showOptions is false', () => {
      render(
        <TestWrapper
          allOptions={['Apple', 'Banana']}
          value=''
          showOptions={false}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.queryByText('Apple')).not.toBeInTheDocument();

      expect(screen.queryByText('Banana')).not.toBeInTheDocument();
    });

    it('shows options when showOptions is true and there are matching options', () => {
      render(
        <TestWrapper allOptions={['Apple', 'Banana']} value='' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByText('Apple')).toBeInTheDocument();

      expect(screen.getByText('Banana')).toBeInTheDocument();
    });

    it('does not show options when there are no matching filtered options', () => {
      render(
        <TestWrapper allOptions={['Apple', 'Banana']} value='xyz' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.queryByText('Apple')).not.toBeInTheDocument();

      expect(screen.queryByText('Banana')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('renders options with proper tabIndex for keyboard navigation', () => {
      render(
        <TestWrapper allOptions={['Apple', 'Banana']} value='' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      const appleOption = screen.getByText('Apple');
      const bananaOption = screen.getByText('Banana');

      expect(appleOption).toHaveAttribute('tabIndex', '0');

      expect(bananaOption).toHaveAttribute('tabIndex', '0');
    });

    it('renders options as list items for screen readers', () => {
      render(
        <TestWrapper allOptions={['Apple', 'Banana']} value='' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      const list = screen.getByRole('list');
      expect(list).toBeInTheDocument();

      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(2);
      expect(listItems[0]).toHaveTextContent('Apple');

      expect(listItems[1]).toHaveTextContent('Banana');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty options array gracefully', () => {
      render(
        <TestWrapper allOptions={[]} value='' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );
      expect(screen.getByRole('textbox')).toBeInTheDocument();

      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('handles undefined value gracefully', () => {
      render(
        <TestWrapper allOptions={['Apple', 'Banana']} showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByText('Apple')).toBeInTheDocument();

      expect(screen.getByText('Banana')).toBeInTheDocument();
    });

    it('handles options with special characters', () => {
      const specialOptions = [
        'Option & Co.',
        'Option "quoted"',
        "Option 'single'"
      ];

      render(
        <TestWrapper allOptions={specialOptions} value='' showOptions>
          <input aria-label='test input' />
        </TestWrapper>
      );

      expect(screen.getByText('Option & Co.')).toBeInTheDocument();
      expect(screen.getByText('Option "quoted"')).toBeInTheDocument();

      expect(screen.getByText("Option 'single'")).toBeInTheDocument();
    });

    it('handles duplicate options correctly', () => {
      const mockOnSelect = jest.fn();

      render(
        <TestWrapper
          allOptions={['Apple', 'Apple', 'Banana']}
          value=''
          showOptions
          onSelect={mockOnSelect}
        >
          <input aria-label='test input' />
        </TestWrapper>
      );

      const appleOptions = screen.getAllByText('Apple');
      expect(appleOptions).toHaveLength(2);

      fireEvent.click(appleOptions[0]);

      expect(mockOnSelect).toHaveBeenCalledWith('Apple');
    });
  });
});

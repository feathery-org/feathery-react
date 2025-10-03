import {
  createPasswordElement,
  createPasswordProps,
  createStatefulOnChange,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordField from '../index';

describe('PasswordField - Base Functionality', () => {
  const input = () =>
    screen.getByLabelText('Test password field') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders PasswordField component with default props', () => {
      const element = createPasswordElement('password');
      const props = createPasswordProps(element);

      render(<PasswordField {...props} />);

      const passwordInput = input();
      expect(passwordInput).toBeTruthy();
      expect(passwordInput.type).toBe('password');
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with disabled state', () => {
      const element = createPasswordElement('password');
      const props = createPasswordProps(element);

      render(<PasswordField {...props} disabled />);

      expectFieldToBeDisabled(input());
    });
  });

  describe('onChange', () => {
    it('handles password input change', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createPasswordElement('password');
      const props = createPasswordProps(element, { onChange: mockOnChange });

      render(<PasswordField {...props} />);

      fireEvent.change(input(), { target: { value: 'Password123!' } });

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toBe('Password123!');
    });
  });
});

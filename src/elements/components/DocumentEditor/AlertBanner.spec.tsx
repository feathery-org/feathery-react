import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AlertBanner from './AlertBanner';

it('renders the message as an alert', () => {
  render(<AlertBanner message='Something broke' />);
  expect(screen.getByRole('alert')).toHaveTextContent('Something broke');
  expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
});

it('fires onDismiss', () => {
  const onDismiss = jest.fn();
  render(<AlertBanner message='Oops' onDismiss={onDismiss} />);
  fireEvent.click(screen.getByLabelText('Dismiss'));
  expect(onDismiss).toHaveBeenCalled();
});

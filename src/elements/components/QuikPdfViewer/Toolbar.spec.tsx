import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Toolbar from './Toolbar';

const baseProps = {
  title: 'Review Your Forms',
  onBack: jest.fn(),
  onReset: jest.fn(),
  onDownload: jest.fn(),
  onPrimary: jest.fn(),
  primaryLabel: 'Sign',
  busy: false,
  zoomLabel: 'Fit',
  canZoomIn: true,
  canZoomOut: true,
  onZoomIn: jest.fn(),
  onZoomOut: jest.fn(),
  onFitWidth: jest.fn(),
  activePage: 2,
  totalPages: 10,
  requiredRemaining: null,
  onJumpToNextField: jest.fn(),
  isNarrow: false
};

it('renders title, page readout, and zoom controls', () => {
  const onZoomIn = jest.fn();
  render(<Toolbar {...baseProps} onZoomIn={onZoomIn} />);
  expect(screen.getByText('Review Your Forms')).toBeInTheDocument();
  expect(screen.getByText('Page 2 of 10')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Zoom in'));
  expect(onZoomIn).toHaveBeenCalled();
});

it('disables actions and keeps the primary label while busy', () => {
  render(<Toolbar {...baseProps} busy />);
  const primary = screen.getByRole('button', { name: /Sign/ });
  expect(primary).toBeDisabled();
  expect(primary).toHaveTextContent('Sign');
});

it('shows the progress pill and jumps to the next field', () => {
  const onJump = jest.fn();
  render(
    <Toolbar {...baseProps} requiredRemaining={3} onJumpToNextField={onJump} />
  );
  fireEvent.click(screen.getByText('3 required fields left'));
  expect(onJump).toHaveBeenCalled();
});

it('shows completion state when no required fields remain', () => {
  render(<Toolbar {...baseProps} requiredRemaining={0} />);
  expect(screen.getByText('All fields complete')).toBeInTheDocument();
});

it('collapses secondary actions into an overflow menu when narrow', () => {
  const onReset = jest.fn();
  render(
    <Toolbar {...baseProps} isNarrow onReset={onReset} onSaveDraft={jest.fn()} />
  );
  expect(
    screen.queryByRole('button', { name: 'Reset' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('More actions'));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(onReset).toHaveBeenCalled();
});

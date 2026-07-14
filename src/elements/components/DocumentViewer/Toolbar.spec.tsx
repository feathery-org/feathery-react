import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Toolbar from './Toolbar';

const baseProps = {
  title: 'Review Your Forms',
  onBack: jest.fn(),
  onDownload: jest.fn(),
  onPrimary: jest.fn(),
  primaryLabel: 'Sign',
  busy: false,
  isNarrow: false
};

it('renders the title, download, and primary action', () => {
  const onPrimary = jest.fn();
  render(<Toolbar {...baseProps} onPrimary={onPrimary} />);
  expect(screen.getByText('Review Your Forms')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Sign/ }));
  expect(onPrimary).toHaveBeenCalled();
});

it('does not render zoom, page, field-status, or reset controls', () => {
  render(<Toolbar {...baseProps} onSaveDraft={jest.fn()} />);
  expect(screen.queryByLabelText('Zoom in')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Fit width')).not.toBeInTheDocument();
  expect(screen.queryByText(/Page \d+ of/)).not.toBeInTheDocument();
  expect(screen.queryByText(/required field/)).not.toBeInTheDocument();
  expect(screen.queryByText('All fields complete')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Reset' })
  ).not.toBeInTheDocument();
});

it('disables actions and keeps the primary label while busy', () => {
  render(<Toolbar {...baseProps} busy />);
  const primary = screen.getByRole('button', { name: /Sign/ });
  expect(primary).toBeDisabled();
  expect(primary).toHaveTextContent('Sign');
});

it('shows Save Draft only when provided', () => {
  const { rerender } = render(<Toolbar {...baseProps} />);
  expect(
    screen.queryByRole('button', { name: 'Save Draft' })
  ).not.toBeInTheDocument();
  rerender(<Toolbar {...baseProps} onSaveDraft={jest.fn()} />);
  expect(
    screen.getByRole('button', { name: 'Save Draft' })
  ).toBeInTheDocument();
});

it('hides Download and Save Draft when singleAction is set (Generate Documents review mode)', () => {
  const onPrimary = jest.fn();
  render(
    <Toolbar
      {...baseProps}
      onSaveDraft={jest.fn()}
      onDownload={undefined}
      primaryLabel='Download'
      onPrimary={onPrimary}
      singleAction
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Save Draft' })
  ).not.toBeInTheDocument();
  // Only one "Download"-named button: the single primary action.
  expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(onPrimary).toHaveBeenCalled();
});

it('collapses Download into an overflow menu when narrow (no Reset)', () => {
  const onDownload = jest.fn();
  render(<Toolbar {...baseProps} isNarrow onDownload={onDownload} />);
  expect(
    screen.queryByRole('button', { name: 'Download' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('More actions'));
  expect(
    screen.queryByRole('button', { name: 'Reset' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(onDownload).toHaveBeenCalled();
});

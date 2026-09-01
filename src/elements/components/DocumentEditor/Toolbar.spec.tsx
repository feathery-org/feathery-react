import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Toolbar, { ToolbarAction } from './Toolbar';

const actions: ToolbarAction[] = [
  {
    key: 'download',
    label: 'Download',
    variant: 'secondary',
    onClick: jest.fn()
  },
  { key: 'primary', label: 'Sign', variant: 'primary', onClick: jest.fn() }
];

const baseProps = {
  title: 'Review Your Forms',
  onBack: jest.fn(),
  actions,
  busyKey: null
};

it('renders the title and each action', () => {
  render(<Toolbar {...baseProps} />);
  expect(screen.getByText('Review Your Forms')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
});

it('fires an action onClick', () => {
  const onClick = jest.fn();
  render(
    <Toolbar
      {...baseProps}
      actions={[{ key: 'primary', label: 'Sign', variant: 'primary', onClick }]}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
  expect(onClick).toHaveBeenCalled();
});

it('shows the spinner only on the busy action and disables every action', () => {
  render(<Toolbar {...baseProps} busyKey='download' />);
  const download = screen.getByRole('button', { name: /Download/ });
  const primary = screen.getByRole('button', { name: 'Sign' });

  // Both disabled while an action runs.
  expect(download).toBeDisabled();
  expect(primary).toBeDisabled();
  // Spinner (svg) renders on the busy action only, not the others.
  expect(download.querySelector('svg')).toBeTruthy();
  expect(primary.querySelector('svg')).toBeFalsy();
  // Label text is preserved on the busy button.
  expect(download).toHaveTextContent('Download');
});

it('does not render Quik-mode zoom, page, or reset controls', () => {
  render(<Toolbar {...baseProps} />);
  expect(screen.queryByLabelText('More actions')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Zoom in')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Fit width')).not.toBeInTheDocument();
  expect(screen.queryByText(/Page \d+ of/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Reset' })
  ).not.toBeInTheDocument();
});

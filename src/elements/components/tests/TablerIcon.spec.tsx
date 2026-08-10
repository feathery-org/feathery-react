import React from 'react';
import { render, waitFor } from '@testing-library/react';
import TablerIcon from '../TablerIcon';

function MockIcon(props: React.SVGProps<SVGSVGElement>) {
  return <svg data-testid='tabler-icon' {...props} />;
}

jest.mock(
  '@tabler/icons-react',
  () => ({
    IconHeart: MockIcon,
    IconHeartFilled: MockIcon,
    createReactComponent: () => null,
    IconProps: {}
  }),
  { virtual: true }
);

describe('TablerIcon', () => {
  it('renders a valid export name after the icon module loads', async () => {
    const { getByTestId } = render(<TablerIcon name='IconHeart' />);

    await waitFor(() => expect(getByTestId('tabler-icon')).toBeInTheDocument());
  });

  it('renders filled export names', async () => {
    const { getByTestId } = render(<TablerIcon name='IconHeartFilled' />);

    await waitFor(() => expect(getByTestId('tabler-icon')).toBeInTheDocument());
  });

  it('renders nothing for unknown and non-string names without stale icons', async () => {
    const { container, rerender } = render(<TablerIcon name='IconHeart' />);

    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());

    rerender(<TablerIcon name='MissingIcon' />);
    expect(container.querySelector('svg')).toBeNull();

    rerender(<TablerIcon name={{}} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('does not expose non-icon helper exports', () => {
    const { container, rerender } = render(
      <TablerIcon name='createReactComponent' />
    );

    expect(container.querySelector('svg')).toBeNull();

    rerender(<TablerIcon name='IconProps' />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

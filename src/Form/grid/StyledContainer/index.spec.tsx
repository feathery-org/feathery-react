import { render } from '@testing-library/react';
import { StyledContainer } from '.';

const baseNode = {
  id: 'container-1',
  key: 'container-1',
  type: 'container',
  isElement: false,
  parent: { styles: { height: 'fit', axis: 'column' } },
  children: [],
  properties: {},
  styles: {
    axis: 'column',
    content_responsive: false,
    height: 200,
    height_unit: 'px',
    width: 'fill',
    width_unit: 'fill'
  }
};

describe('StyledContainer iframe embeds', () => {
  it('renders iframe URL containers with auto-scrolling iframe viewport styles', () => {
    const { container } = render(
      <StyledContainer
        node={{
          ...baseNode,
          properties: { iframe_url: 'https://example.com/form' }
        }}
        breakpoint={480}
      />
    );

    const iframe = container.querySelector('iframe');

    expect(iframe).toBeTruthy();
    expect(iframe).toHaveAttribute('src', 'https://example.com/form');
    expect(iframe).toHaveAttribute('scrolling', 'auto');
    expect(iframe).toHaveStyle({
      border: 'none',
      display: 'block',
      flex: '1 1 auto',
      height: '100%',
      maxHeight: '100%',
      minHeight: '0',
      overflow: 'auto',
      width: '100%'
    });
  });

  it('does not add container overflow behavior when iframe container overflow is unset', () => {
    const { container } = render(
      <StyledContainer
        node={{
          ...baseNode,
          properties: { iframe_url: 'https://example.com/form' }
        }}
        breakpoint={480}
      />
    );

    expect(container.querySelector('.styled-container')).not.toHaveStyle({
      overflowY: 'auto'
    });
  });
});

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

describe('StyledContainer alignment', () => {
  it('preserves pixel height for centered content when padding is omitted', () => {
    const { container } = render(
      <StyledContainer
        node={{
          id: 'centered-container',
          key: 'centered-container',
          type: 'container',
          isElement: false,
          parent: {
            axis: 'column',
            height: 'fit',
            styles: {}
          },
          children: [{}],
          axis: 'row',
          width: '40px',
          height: '40px',
          properties: {},
          styles: {
            horizontal_align: 'center',
            vertical_align: 'center'
          },
          mobile_styles: {}
        }}
        breakpoint={480}
      >
        <span>3</span>
      </StyledContainer>
    );

    expect(container.querySelector('.inner-container')).toHaveStyle({
      minHeight: '40px',
      alignItems: 'center',
      justifyContent: 'center'
    });
  });
});

describe('StyledContainer document editor', () => {
  it('mounts the document editor placeholder when document_editor is set', () => {
    const { getByText } = render(
      <StyledContainer
        node={{
          ...baseNode,
          properties: { document_editor: true }
        }}
        editMode
        breakpoint={480}
      />
    );

    expect(getByText('Document editor')).toBeTruthy();
  });

  it('does not mount the document editor when document_editor is unset', () => {
    const { queryByText } = render(
      <StyledContainer node={baseNode} editMode breakpoint={480} />
    );

    expect(queryByText('Document editor')).toBeNull();
  });
});

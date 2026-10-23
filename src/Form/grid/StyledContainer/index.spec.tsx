import { render } from '@testing-library/react';
import { StyledContainer } from '.';
import { fieldValues, setFieldValues } from '../../../utils/init';
import { featheryWindow } from '../../../utils/browser';

jest.mock('../../../elements/components/DocxEditor', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ preview }: { preview?: boolean }) =>
      React.createElement('div', {
        'data-testid': 'blank-document-preview',
        'data-preview': String(!!preview)
      })
  };
});

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
  afterEach(() => {
    delete fieldValues.extraction_review_url;
  });

  it.each([
    '{{extraction_review_url}}',
    '/review/{{submission_id}}',
    `${featheryWindow().location.origin}/review/{{submission_id}}`,
    ''
  ])(
    'skips an unresolved same-origin or empty editor embed URL: %s',
    (source) => {
      const { container } = render(
        <StyledContainer
          node={{ ...baseNode, properties: { iframe_url: source } }}
          breakpoint={480}
          editMode
        >
          <span>Container contents</span>
        </StyledContainer>
      );

      expect(container.querySelector('iframe')).toBeNull();
      expect(container).toHaveTextContent('Container contents');
    }
  );

  it.each([
    'https://calendly.com/team/demo?email={{email}}',
    '//calendly.com/team/demo?email={{email}}'
  ])(
    'preserves an external editor embed with unresolved parameters: %s',
    (source) => {
      const { container } = render(
        <StyledContainer
          node={{ ...baseNode, properties: { iframe_url: source } }}
          breakpoint={480}
          editMode
        />
      );

      expect(container.querySelector('iframe')).toHaveAttribute('src', source);
    }
  );

  it('preserves unresolved live-form embeds', () => {
    const source = '{{extraction_review_url}}';
    const { container } = render(
      <StyledContainer
        node={{ ...baseNode, properties: { iframe_url: source } }}
        breakpoint={480}
      />
    );

    expect(container.querySelector('iframe')).toHaveAttribute('src', source);
  });

  it('renders an editor embed once its field resolves to a nonempty URL', () => {
    const props = {
      node: {
        ...baseNode,
        properties: { iframe_url: '{{extraction_review_url}}' }
      },
      breakpoint: 480,
      editMode: true
    };
    const { container, rerender } = render(<StyledContainer {...props} />);
    expect(container.querySelector('iframe')).toBeNull();

    const url = 'https://example.com/review/submission-1';
    setFieldValues({ extraction_review_url: url }, false, true);
    rerender(<StyledContainer {...props} />);
    expect(container.querySelector('iframe')).toHaveAttribute('src', url);

    setFieldValues({ extraction_review_url: '' }, false, true);
    rerender(<StyledContainer {...props} />);
    expect(container.querySelector('iframe')).toBeNull();
  });

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
  it.each([
    ['no', []],
    ['one', [{}]]
  ])(
    'bounds a fill-height document editor with %s builder children',
    (_, builderChildren) => {
      const { container } = render(
        <StyledContainer
          node={{
            ...baseNode,
            height: 'fill',
            parent: { height: 'fill', axis: 'row', styles: {} },
            children: builderChildren,
            properties: { document_editor: true },
            styles: { axis: 'column', width: 'fill', width_unit: 'fill' }
          }}
          editMode
          breakpoint={480}
        />
      );

      expect(container.querySelector('.styled-container')).toHaveStyle({
        height: '100%',
        maxHeight: '100%',
        minHeight: '0',
        overflow: 'hidden',
        flexGrow: '1',
        flexShrink: '1',
        flexBasis: '0'
      });
      expect(container.querySelector('.inner-container')).toHaveStyle({
        minHeight: '0'
      });
    }
  );

  it('keeps a fit-height document editor content-sized', () => {
    const { container } = render(
      <StyledContainer
        node={{
          ...baseNode,
          height: 'fit',
          children: [{}],
          properties: { document_editor: true },
          styles: { axis: 'column', width: 'fill', width_unit: 'fill' }
        }}
        editMode
        breakpoint={480}
      />
    );

    expect(container.querySelector('.styled-container')).toHaveStyle({
      height: 'auto',
      maxHeight: 'fit-content',
      minHeight: 'fit-content'
    });
  });

  it('preserves content sizing for a regular fill-height container', () => {
    const { container } = render(
      <StyledContainer
        node={{
          ...baseNode,
          height: 'fill',
          children: [{}],
          styles: { axis: 'column', width: 'fill', width_unit: 'fill' }
        }}
        breakpoint={480}
      >
        <span>Regular contents</span>
      </StyledContainer>
    );

    expect(container.querySelector('.styled-container')).toHaveStyle({
      height: 'auto',
      maxHeight: '100%',
      minHeight: 'fit-content'
    });
  });

  it('keeps a document editor inside its configured pixel dimensions', () => {
    const { container } = render(
      <StyledContainer
        node={{
          ...baseNode,
          width: '640px',
          height: '360px',
          children: [{}],
          properties: { document_editor: true },
          styles: {
            ...baseNode.styles,
            width: 640,
            width_unit: 'px',
            height: 360
          }
        }}
        editMode
        breakpoint={480}
      />
    );

    expect(container.querySelector('.styled-container')).toHaveStyle({
      minWidth: '0',
      height: '360px',
      maxHeight: '360px'
    });
    expect(container.querySelector('.inner-container')).toHaveStyle({
      minHeight: '0'
    });
  });

  it('uses the mobile fill behavior while preserving the desktop pixel height', () => {
    const node = {
      ...baseNode,
      height: '360px',
      mobile_height: 'fill',
      properties: { document_editor: true },
      styles: { ...baseNode.styles, height: 360 },
      mobile_styles: { height: 'fill', height_unit: 'fill' }
    };
    const { container, rerender } = render(
      <StyledContainer
        node={node}
        breakpoint={480}
        viewportOnly
        viewport='desktop'
      />
    );

    expect(container.querySelector('.styled-container')).toHaveStyle({
      height: '360px',
      maxHeight: '360px'
    });

    rerender(
      <StyledContainer
        node={node}
        breakpoint={480}
        viewportOnly
        viewport='mobile'
      />
    );
    expect(container.querySelector('.styled-container')).toHaveStyle({
      height: '100%',
      maxHeight: '100%',
      minHeight: '0',
      overflow: 'hidden'
    });
  });

  it('mounts the document editor preview when document_editor is set', () => {
    const { getByTestId } = render(
      <StyledContainer
        node={{
          ...baseNode,
          properties: { document_editor: true }
        }}
        editMode
        breakpoint={480}
      />
    );

    expect(getByTestId('blank-document-preview')).toHaveAttribute(
      'data-preview',
      'true'
    );
  });

  it('does not mount the document editor when document_editor is unset', () => {
    const { queryByTestId } = render(
      <StyledContainer node={baseNode} editMode breakpoint={480} />
    );

    expect(queryByTestId('blank-document-preview')).toBeNull();
  });
});

describe('StyledContainer table elements', () => {
  const tableNode = (widthUnit: string, type: string) => ({
    ...baseNode,
    id: 'table-1',
    key: 'table-1',
    type: 'Element',
    _type: type,
    isElement: true,
    parent: { styles: { height: 'fit', axis: 'row' } },
    styles: {
      ...baseNode.styles,
      width: widthUnit === 'px' ? 400 : widthUnit,
      width_unit: widthUnit
    }
  });

  it.each([
    ['table', 'fill'],
    ['table', 'fit'],
    ['table_element', 'fill'],
    ['table_element', 'fit']
  ])(
    'never lets a %s node with %s width grow to its grid width',
    (type, widthUnit) => {
      // The grid scrolls inside its own box, so its intrinsic width must not
      // reach the wrapper — a min-content floor would push the step wider than
      // the viewport. The designer canvas names the node 'table_element'.
      const { container } = render(
        <StyledContainer node={tableNode(widthUnit, type)} breakpoint={480}>
          <div />
        </StyledContainer>
      );
      const wrapper = container.firstElementChild as HTMLElement;
      // jsdom reports a unitless zero.
      expect(['0', '0px']).toContain(getComputedStyle(wrapper).minWidth);
    }
  );
});

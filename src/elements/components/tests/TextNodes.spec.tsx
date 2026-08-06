import { render } from '@testing-library/react';
import ResponsiveStyles from '../../styles';
import TextNodes from '../TextNodes';

// The Tabler glyph loads via an async chunk; the atomic wrapper node (which is
// what the builder's blur serializer reads) renders synchronously regardless,
// so mock the glyph to null and assert on the wrapper.
jest.mock('../TablerIcon', () => () => null);

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn()
    }))
  });
});

const stylesFor = (element: any) =>
  new ResponsiveStyles(element, ['text'], true);

describe('TextNodes inline icon embed', () => {
  it('renders an icon embed op as an atomic node with data-feathery-icon + data-index', () => {
    const element = {
      id: 'text-icon',
      repeat: 0,
      properties: {
        text: '',
        text_formatted: [
          { insert: 'Save ', attributes: {} },
          {
            insert: { icon: 'IconHeart' },
            attributes: { font_size: 16, font_color: 'FF0000FF' }
          }
        ]
      }
    };

    const { container } = render(
      <TextNodes
        element={element}
        responsiveStyles={stylesFor(element)}
        cssTarget='text'
        editMode='editable'
      />
    );

    const iconNode = container.querySelector('[data-feathery-icon="IconHeart"]');
    expect(iconNode).not.toBeNull();
    // Op index is the contract the blur serializer maps attributes back through.
    expect(iconNode?.getAttribute('data-index')).toBe('1');
    // Atomic in the contenteditable so the caret can't split the glyph.
    expect(iconNode?.getAttribute('contenteditable')).toBe('false');
    // Surrounding text still renders as its own indexed span.
    expect(container.querySelector('[data-index="0"]')?.textContent).toBe(
      'Save '
    );
  });

  it('renders a plain string op as text, never as an icon node', () => {
    const element = {
      id: 'text-plain',
      repeat: 0,
      properties: {
        text: '',
        text_formatted: [{ insert: 'Hello', attributes: {} }]
      }
    };

    const { container } = render(
      <TextNodes
        element={element}
        responsiveStyles={stylesFor(element)}
        cssTarget='text'
        editMode='editable'
      />
    );

    expect(container.querySelector('[data-feathery-icon]')).toBeNull();
    expect(container.querySelector('[data-index="0"]')?.textContent).toBe(
      'Hello'
    );
  });
});

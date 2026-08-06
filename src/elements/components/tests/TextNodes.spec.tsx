import { render } from '@testing-library/react';
import ResponsiveStyles from '../../styles';
import TextNodes from '../TextNodes';

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

const makeElement = (textFormatted: any[]) => ({
  id: 'text-1',
  properties: {
    text: 'placeholder',
    text_formatted: textFormatted,
    actions: []
  },
  styles: {},
  mobile_styles: {}
});

const renderNodes = (textFormatted: any[], editMode?: any, focused = false) => {
  const element = makeElement(textFormatted);
  const responsiveStyles = new ResponsiveStyles(element, ['text'], true);
  return render(
    <TextNodes
      element={element}
      responsiveStyles={responsiveStyles}
      editMode={editMode}
      focused={focused}
    />
  );
};

describe('TextNodes icon embeds', () => {
  it('renders icon ops as tagged glyph wrappers between text runs', () => {
    const { container } = renderNodes([
      { insert: 'Pay ' },
      { insert: { icon: 'IconHeart' }, attributes: { color: 'FF0000FF' } },
      { insert: ' now' }
    ]);
    const icon = container.querySelector('[data-feathery-icon="IconHeart"]');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('data-index')).toBe('1');
    expect(container.textContent).toContain('Pay');
    expect(container.textContent).toContain('now');
  });

  it('marks icon nodes non-editable in edit mode', () => {
    const { container } = renderNodes(
      [{ insert: { icon: 'IconStar' } }],
      'editable'
    );
    const icon = container.querySelector('[data-feathery-icon="IconStar"]');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('contenteditable')).toBe('false');
  });

  it('drops whitespace-only text runs in icon-only labels', () => {
    const { container } = renderNodes([
      { insert: { icon: 'IconTrash' } },
      { insert: '\n' }
    ]);
    expect(
      container.querySelector('[data-feathery-icon="IconTrash"]')
    ).not.toBeNull();
    expect((container.textContent ?? '').trim()).toBe('');
    // The whitespace op must not render a span at all
    expect(container.querySelectorAll('span[data-index]').length).toBe(1);
  });

  it('keeps whitespace runs while focused for editing (caret targets)', () => {
    const { container } = renderNodes(
      [{ insert: { icon: 'IconTrash' } }, { insert: '\n' }],
      'editable',
      true
    );
    // Icon node + whitespace span both render so the caret has a target
    expect(container.querySelectorAll('span[data-index]').length).toBe(2);
  });

  it('keeps whitespace runs when real text accompanies an icon', () => {
    const { container } = renderNodes([
      { insert: { icon: 'IconTrash' } },
      { insert: ' Delete' }
    ]);
    expect(container.textContent).toContain('Delete');
  });

  it('skips unknown object embeds without crashing text rendering', () => {
    const { container } = renderNodes([
      { insert: 'before' },
      { insert: { video: 'clip.mp4' } },
      { insert: 'after' }
    ]);
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
    expect(container.querySelector('[data-feathery-icon]')).toBeNull();
  });
});

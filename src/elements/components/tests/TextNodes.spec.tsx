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

// Icon embeds carry the glyph's shape data; the name only labels it.
const iconOp = (icon: string, attributes?: any) => ({
  insert: {
    icon,
    glyph: { variant: 'outline', nodes: [['path', { d: 'M12 5l0 14' }]] }
  },
  ...(attributes ? { attributes } : {})
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
      iconOp('IconHeart', { color: 'FF0000FF' }),
      { insert: ' now' }
    ]);
    const icon = container.querySelector('[data-feathery-icon="IconHeart"]');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('data-index')).toBe('1');
    expect(container.textContent).toContain('Pay');
    expect(container.textContent).toContain('now');
  });

  it('renders the glyph from persisted shape data, colored by currentColor', () => {
    const { container } = renderNodes([iconOp('IconHeart')]);
    const svg = container.querySelector('[data-feathery-icon] svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M12 5l0 14');
  });

  it('fills with currentColor for filled variants', () => {
    const { container } = renderNodes([
      {
        insert: {
          icon: 'IconHeartFilled',
          glyph: { variant: 'filled', nodes: [['path', { d: 'M12 5l0 14' }]] }
        }
      }
    ]);
    const svg = container.querySelector('[data-feathery-icon] svg')!;
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('stroke')).toBe('none');
  });

  it('drops unsafe tags and attributes from glyph data', () => {
    // Glyph data is writable through the API, so only geometry with plain SVG
    // attributes may render.
    const { container } = renderNodes([
      {
        insert: {
          icon: 'IconEvil',
          glyph: {
            variant: 'outline',
            nodes: [
              ['script', { d: 'ignored' }],
              ['image', { href: 'https://example.com/x.png' }],
              [
                'path',
                {
                  d: 'M12 5l0 14',
                  onLoad: 'alert(1)',
                  'xlink:href': 'https://example.com',
                  style: 'color: red'
                }
              ]
            ]
          }
        }
      }
    ]);
    const svg = container.querySelector('[data-feathery-icon] svg')!;
    expect(svg.querySelector('script')).toBeNull();
    expect(svg.querySelector('image')).toBeNull();
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M12 5l0 14');
    expect(path.getAttribute('onLoad')).toBeNull();
    expect(path.getAttribute('xlink:href')).toBeNull();
    expect(path.getAttribute('style')).toBeNull();
  });

  it('renders nothing for an embed with no usable glyph data', () => {
    const { container } = renderNodes([
      { insert: 'before' },
      { insert: { icon: 'IconHeart' } },
      { insert: 'after' }
    ]);
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
    expect(container.querySelector('[data-feathery-icon]')).toBeNull();
  });

  it('marks icon nodes non-editable in edit mode', () => {
    const { container } = renderNodes([iconOp('IconStar')], 'editable');
    const icon = container.querySelector('[data-feathery-icon="IconStar"]');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('contenteditable')).toBe('false');
  });

  it('drops whitespace-only text runs in icon-only labels', () => {
    const { container } = renderNodes([iconOp('IconTrash'), { insert: '\n' }]);
    expect(
      container.querySelector('[data-feathery-icon="IconTrash"]')
    ).not.toBeNull();
    expect((container.textContent ?? '').trim()).toBe('');
    // The whitespace op must not render a span at all
    expect(container.querySelectorAll('span[data-index]').length).toBe(1);
  });

  it('keeps whitespace runs while focused for editing (caret targets)', () => {
    const { container } = renderNodes(
      [iconOp('IconTrash'), { insert: '\n' }],
      'editable',
      true
    );
    // Icon node + whitespace span both render so the caret has a target
    expect(container.querySelectorAll('span[data-index]').length).toBe(2);
  });

  it('keeps whitespace runs when real text accompanies an icon', () => {
    const { container } = renderNodes([
      iconOp('IconTrash'),
      { insert: ' Delete' }
    ]);
    expect(container.textContent).toContain('Delete');
  });

  it('keeps the label bottom padding for plain text, drops it for icons', () => {
    // The 2px nudge ships in every published form, so it may only come off for
    // labels that actually contain a glyph.
    const plain = renderNodes([{ insert: 'Just text' }]);
    const plainSpan = plain.container.querySelector('#span-text-1')!;
    expect(getComputedStyle(plainSpan).paddingBottom).toBe('2px');

    const withIcon = renderNodes([{ insert: 'Pay ' }, iconOp('IconHeart')]);
    const iconSpan = withIcon.container.querySelector('#span-text-1')!;
    expect(getComputedStyle(iconSpan).paddingBottom).toBe('0px');
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

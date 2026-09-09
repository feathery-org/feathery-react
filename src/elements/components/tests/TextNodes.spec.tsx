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
                  xlinkHref: 'https://example.com',
                  href: 'https://example.com',
                  src: 'https://example.com/x.png',
                  id: 'external-target',
                  className: 'external-class',
                  filter: 'url(#external-filter)',
                  mask: 'url(#external-mask)',
                  fill: 'URL(#external-fill)',
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
    expect(path.getAttribute('xlinkHref')).toBeNull();
    expect(path.getAttribute('href')).toBeNull();
    expect(path.getAttribute('src')).toBeNull();
    expect(path.getAttribute('id')).toBeNull();
    expect(path.getAttribute('class')).toBeNull();
    expect(path.getAttribute('filter')).toBeNull();
    expect(path.getAttribute('mask')).toBeNull();
    expect(path.getAttribute('fill')).toBeNull();
    expect(path.getAttribute('style')).toBeNull();
  });

  it('keeps only valid Tabler path geometry and child colors', () => {
    const { container } = renderNodes([
      {
        insert: {
          icon: 'IconShape',
          glyph: {
            variant: 'outline',
            nodes: [
              ['circle', { cx: 12, cy: 12, r: 10 }],
              ['path', { fill: 'red', stroke: 'blue', d: 'M0 0h24' }],
              ['path', { d: 'M0 0h24', opacity: '0' }],
              ['path', { d: 'M0 0 url(#external)' }],
              ['path', { d: 'M0 0<script>' }],
              [
                'path',
                {
                  fill: 'currentColor',
                  stroke: 'none',
                  opacity: '.5',
                  d: 'M1 1h22'
                }
              ],
              ['path', { fill: 'currentColor' }]
            ]
          }
        }
      }
    ]);
    const paths = container.querySelectorAll('[data-feathery-icon] svg path');
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')).toBe('M0 0h24');
    expect(paths[0].getAttribute('fill')).toBeNull();
    expect(paths[0].getAttribute('stroke')).toBeNull();
    expect(paths[1].getAttribute('fill')).toBe('currentColor');
    expect(paths[1].getAttribute('stroke')).toBe('none');
    expect(paths[1].getAttribute('opacity')).toBe('.5');
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

  it('renders linked icons with the same external-link contract as text', () => {
    const { container } = renderNodes([
      iconOp('IconExternalLink', {
        font_link: 'https://example.com/icon'
      })
    ]);
    const icon = container.querySelector(
      '[data-feathery-icon="IconExternalLink"]'
    );

    expect(icon?.tagName.toLowerCase()).toBe('a');
    expect(icon).toHaveAttribute('href', 'https://example.com/icon');
    expect(icon).toHaveAttribute('target', '_blank');
    expect(icon).toHaveAttribute('rel', 'noreferrer');
    expect(icon?.querySelector('svg')).not.toBeNull();
  });

  it('keeps linked icons as atomic spans while editing', () => {
    const { container } = renderNodes(
      [
        iconOp('IconExternalLink', {
          font_link: 'https://example.com/icon'
        })
      ],
      'editable',
      true
    );
    const icon = container.querySelector(
      '[data-feathery-icon="IconExternalLink"]'
    );

    expect(icon?.tagName.toLowerCase()).toBe('span');
    expect(icon).toHaveAttribute('data-index', '0');
    expect(icon).toHaveAttribute('contenteditable', 'false');
    expect(icon).not.toHaveAttribute('href');
  });

  it('does not leak the final run styles onto earlier runs while editing', () => {
    const { container } = renderNodes(
      [
        { insert: 'Plain' },
        {
          insert: 'Styled',
          attributes: {
            font_color: 'FF0000FF',
            font_size: 27,
            font_weight: 700
          }
        }
      ],
      'editable',
      true
    );
    const runs = container.querySelectorAll('span[data-index]');

    expect(getComputedStyle(runs[0]).color).not.toBe('rgba(255, 0, 0, 1)');
    expect(getComputedStyle(runs[0]).fontSize).not.toBe('27px');
    expect(getComputedStyle(runs[1]).color).toBe('rgba(255, 0, 0, 1)');
    expect(getComputedStyle(runs[1]).fontSize).toBe('27px');
  });

  it('drops whitespace-only text runs in icon-only labels', () => {
    const { container } = renderNodes([iconOp('IconTrash'), { insert: ' ' }]);
    expect(
      container.querySelector('[data-feathery-icon="IconTrash"]')
    ).not.toBeNull();
    expect((container.textContent ?? '').trim()).toBe('');
    expect(container.querySelectorAll('span[data-index]').length).toBe(1);
  });

  it('keeps whitespace runs while focused for editing (caret targets)', () => {
    const { container } = renderNodes(
      [iconOp('IconTrash'), { insert: ' ' }],
      'editable',
      true
    );
    expect(container.querySelectorAll('span[data-index]').length).toBe(2);
    expect(container.querySelector('#span-text-1')).toHaveAttribute(
      'contenteditable',
      'true'
    );
  });

  it('keeps whitespace runs when real text accompanies an icon', () => {
    const { container } = renderNodes([
      iconOp('IconTrash'),
      { insert: ' Delete' }
    ]);
    expect(container.textContent).toContain('Delete');
  });

  it('keeps the label bottom padding for plain text, drops it for icons', () => {
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

  it('does not treat unknown object embeds as icon-only labels', () => {
    const { container } = renderNodes([
      { insert: { video: 'clip.mp4' } },
      { insert: ' ' }
    ]);
    expect(container.querySelectorAll('span[data-index]')).toHaveLength(1);
  });
});

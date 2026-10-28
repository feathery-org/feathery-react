import { render } from '@testing-library/react';
import { IconGlyph, iconGlyphDataUrl } from '../icons/iconGlyph';

const glyph = {
  variant: 'outline' as const,
  nodes: [['path', { d: 'M12 5v14' }]] as [string, Record<string, string>][]
};

it('renders safe background geometry with the authored alpha color', () => {
  const svg = decodeURIComponent(
    iconGlyphDataUrl(glyph, 'F5A62380').split(',')[1]
  );
  expect(svg).toContain('color="#F5A62380"');
  expect(svg).toContain('stroke="currentColor"');
  expect(svg).toContain('d="M12 5v14"');
});

it('rejects unsafe geometry and escapes attributes in background images', () => {
  expect(iconGlyphDataUrl({ nodes: [['script', { d: 'M0 0' }]] })).toBe('');
  expect(
    iconGlyphDataUrl({ nodes: [['path', { d: 'url(https://example.com)' }]] })
  ).toBe('');
  const svg = decodeURIComponent(
    iconGlyphDataUrl(
      { nodes: [['path', { d: 'M0 0" onload="x', onload: 'x' }]] },
      'red" onload="x'
    ).split(',')[1]
  );
  expect(svg).toContain('color="#000000"');
  expect(svg).toContain('d="M0 0&quot;');
  expect(svg).not.toContain(' onload="');
});

const renderSvg = (glyph: any) =>
  render(<IconGlyph glyph={glyph} />).container.querySelector('svg');

it('renders persisted outline geometry colored by currentColor', () => {
  const svg = renderSvg(glyph)!;
  expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  expect(svg.getAttribute('stroke')).toBe('currentColor');
  expect(svg.getAttribute('fill')).toBe('none');
  expect(svg.querySelector('path')!.getAttribute('d')).toBe('M12 5v14');
});

it('fills with currentColor for filled variants', () => {
  const svg = renderSvg({ ...glyph, variant: 'filled' })!;
  expect(svg.getAttribute('fill')).toBe('currentColor');
  expect(svg.getAttribute('stroke')).toBe('none');
});

it('drops unsafe tags and attributes from glyph data', () => {
  const svg = renderSvg({
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
  })!;
  expect(svg.querySelector('script')).toBeNull();
  expect(svg.querySelector('image')).toBeNull();
  const path = svg.querySelector('path')!;
  expect(path.getAttribute('d')).toBe('M12 5l0 14');
  for (const attribute of [
    'onLoad',
    'xlink:href',
    'xlinkHref',
    'href',
    'src',
    'id',
    'class',
    'filter',
    'mask',
    'fill',
    'style'
  ]) {
    expect(path.getAttribute(attribute)).toBeNull();
  }
});

it('keeps only valid Tabler path geometry and child colors', () => {
  const svg = renderSvg({
    variant: 'outline',
    nodes: [
      ['circle', { cx: 12, cy: 12, r: 10 }],
      ['path', { fill: 'red', stroke: 'blue', d: 'M0 0h24' }],
      ['path', { d: 'M0 0h24', opacity: '0' }],
      ['path', { d: 'M0 0 url(#external)' }],
      ['path', { d: 'M0 0<script>' }],
      [
        'path',
        { fill: 'currentColor', stroke: 'none', opacity: '.5', d: 'M1 1h22' }
      ],
      ['path', { fill: 'currentColor' }]
    ]
  })!;
  const paths = svg.querySelectorAll('path');
  expect(paths).toHaveLength(2);
  expect(paths[0].getAttribute('d')).toBe('M0 0h24');
  expect(paths[0].getAttribute('fill')).toBeNull();
  expect(paths[0].getAttribute('stroke')).toBeNull();
  expect(paths[1].getAttribute('fill')).toBe('currentColor');
  expect(paths[1].getAttribute('stroke')).toBe('none');
  expect(paths[1].getAttribute('opacity')).toBe('.5');
});

it('renders nothing without usable glyph data', () => {
  expect(renderSvg(undefined)).toBeNull();
  expect(
    renderSvg({ variant: 'outline', nodes: [['script', { d: 'M0 0' }]] })
  ).toBeNull();
});

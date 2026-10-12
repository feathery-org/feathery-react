import { iconGlyphDataUrl } from '../icons/iconGlyph';

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

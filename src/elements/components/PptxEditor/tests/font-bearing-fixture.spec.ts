import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { setTextStyle } from '../core/model/edit';
import { eotToTtf, parseEotMetadata, canLegallyEdit } from 'mtx-decompressor';

const fixturePath = (name: string) => resolve(__dirname, 'fixtures', name);
const manifest = JSON.parse(
  readFileSync(fixturePath('marketing-fonts.json'), 'utf8')
);
const fixture = () =>
  importDeck(new Uint8Array(readFileSync(fixturePath('marketing-fonts.pptx'))));

it('retains every referenced original font binary and decodes real editable sfnt data', () => {
  const deck = fixture();
  expect(deck.slides).toHaveLength(28);
  const fontRels = deck.pkg
    .rels('ppt/presentation.xml')
    .filter((rel) => rel.type.endsWith('/font'));
  expect(fontRels).toHaveLength(24);
  expect(fontRels.map((rel) => rel.target).sort()).toEqual(
    Object.keys(manifest.fontParts).sort()
  );
  for (const { target } of fontRels) {
    const bytes = deck.pkg.binary(target);
    if (!bytes) throw new Error(`Missing embedded font: ${target}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      manifest.fontParts[target]
    );
    expect(canLegallyEdit(parseEotMetadata(bytes))).toBe(true);
    const sfnt = eotToTtf(bytes);
    expect(Array.from(sfnt.slice(0, 4))).toEqual([0, 1, 0, 0]);
    expect(sfnt.byteLength).toBeGreaterThan(1000);
  }
});

it('preserves all embedded font bytes after a text-style edit, export, and reopen', () => {
  const deck = fixture();
  const slide = deck.slides[5];
  const shape = slide.shapes.find((node) => node.text?.paragraphs.length);
  if (!shape) throw new Error('Fixture slide 6 has no editable text');
  setTextStyle(deck, slide, shape, { italic: true });
  const reopened = importDeck(exportDeckBytes(deck));
  for (const [part, hash] of Object.entries(manifest.fontParts)) {
    const bytes = reopened.pkg.binary(part);
    if (!bytes) throw new Error(`Font lost during export: ${part}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  }
});

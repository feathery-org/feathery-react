import { isDirectionColumn } from '../styles';

describe('isDirectionColumn', () => {
  it('reads the flex directions a theme can store', () => {
    expect(isDirectionColumn('column')).toBe(true);
    expect(isDirectionColumn('column-reverse')).toBe(true);
    expect(isDirectionColumn('row')).toBe(false);
    expect(isDirectionColumn('row-reverse')).toBe(false);
  });

  it('treats an unstored direction as a row', () => {
    // applyContentAlign runs as soon as any of its keys is set, so a theme
    // carrying text_align without flex_direction reaches here with undefined.
    // Row is the value every tier that does seed the key stores.
    expect(isDirectionColumn(undefined)).toBe(false);
    expect(isDirectionColumn(null)).toBe(false);
    expect(isDirectionColumn('')).toBe(false);
  });
});

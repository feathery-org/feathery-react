import { toInputHex } from './useEditorFormatState';

// <input type='color'> accepts only '#rrggbb'. EJ2 hands the toolbar 8-digit
// alpha hex — '#00000000' is its "automatic" color — which the browser
// rejects with a console warning on every selection change.
describe('toInputHex', () => {
  it('passes conforming 6-digit hex through untouched', () => {
    expect(toInputHex('#1a2b3c')).toBe('#1a2b3c');
    expect(toInputHex('#FFFFFF')).toBe('#FFFFFF');
  });

  it('drops the alpha pair from 8-digit hex', () => {
    expect(toInputHex('#00000000')).toBe('#000000');
    expect(toInputHex('#1A2B3CFF')).toBe('#1A2B3C');
  });

  it('maps anything non-conforming to black', () => {
    expect(toInputHex('empty')).toBe('#000000');
    expect(toInputHex('red')).toBe('#000000');
    expect(toInputHex('')).toBe('#000000');
    expect(toInputHex('#abc')).toBe('#000000');
  });
});

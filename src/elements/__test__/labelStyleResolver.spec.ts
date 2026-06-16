import {
  resolveLabelStyle,
  LABEL_INHERITED_FONT_KEYS,
  LABEL_TEXT_ALIGN_DEFAULT,
  LABEL_GAP_DEFAULT,
  LABEL_GAP_DEFAULT_CHECKBOX
} from '../utils/labelStyleResolver';

describe('resolveLabelStyle', () => {
  it('falls back each unset label_* font prop to the field value', () => {
    const style = {
      font_size: 16,
      font_family: 'Arial',
      font_color: '000000FF',
      font_weight: 400
    };
    const resolved = resolveLabelStyle(style);
    expect(resolved.label_font_size).toBe(16);
    expect(resolved.label_font_family).toBe('Arial');
    expect(resolved.label_font_color).toBe('000000FF');
    expect(resolved.label_font_weight).toBe(400);
  });

  it('prefers an explicitly-set label_* value over the field value', () => {
    const style = { font_size: 16, label_font_size: 20 };
    expect(resolveLabelStyle(style).label_font_size).toBe(20);
  });

  it('keeps a falsy-but-defined label value (does not fall back)', () => {
    // font_italic false is a real value, not "unset" — must not fall back to field
    const style = { font_italic: true, label_font_italic: false };
    expect(resolveLabelStyle(style).label_font_italic).toBe(false);
  });

  it('defaults label_text_align to the renderer default when unset', () => {
    expect(resolveLabelStyle({ text_align: 'center' }).label_text_align).toBe(
      LABEL_TEXT_ALIGN_DEFAULT
    );
    expect(LABEL_TEXT_ALIGN_DEFAULT).toBe('left');
  });

  it('uses an explicitly-set label_text_align', () => {
    expect(
      resolveLabelStyle({ label_text_align: 'center' }).label_text_align
    ).toBe('center');
  });

  it('returns a label_ key for every inherited font key plus text_align', () => {
    const resolved = resolveLabelStyle({});
    LABEL_INHERITED_FONT_KEYS.forEach((key) => {
      expect(resolved).toHaveProperty(`label_${key}`);
    });
    expect(resolved).toHaveProperty('label_text_align');
  });

  it('handles being called with no style object', () => {
    expect(resolveLabelStyle().label_text_align).toBe(LABEL_TEXT_ALIGN_DEFAULT);
  });

  it('defaults label_gap to the renderer default when unset', () => {
    expect(resolveLabelStyle({}).label_gap).toBe(LABEL_GAP_DEFAULT);
  });

  it('defaults label_gap to 0 for checkbox fields', () => {
    expect(resolveLabelStyle({}, { fieldType: 'checkbox' }).label_gap).toBe(
      LABEL_GAP_DEFAULT_CHECKBOX
    );
  });

  it('uses an explicitly-set label_gap over the default', () => {
    expect(resolveLabelStyle({ label_gap: 24 }).label_gap).toBe(24);
    expect(
      resolveLabelStyle({ label_gap: 24 }, { fieldType: 'checkbox' }).label_gap
    ).toBe(24);
  });
});

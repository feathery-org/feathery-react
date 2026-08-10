import ResponsiveStyles from '../../styles';
import { applyFieldStyles } from '../index';

const PADDING = {
  uploader_padding_top: 20,
  uploader_padding_right: 21,
  uploader_padding_bottom: 22,
  uploader_padding_left: 23
};

// Every theme carries these, and some field types read them unguarded.
const BASE_STYLES = { background_color: 'FFFFFFFF', flex_direction: 'row' };

function targets(type: string, styles: any = {}, properties: any = {}) {
  const element = {
    servar: { type, metadata: {} },
    properties,
    styles: { ...BASE_STYLES, ...styles },
    mobile_styles: {}
  };
  const responsiveStyles = new ResponsiveStyles(element, [], true);
  applyFieldStyles(element, responsiveStyles);
  return responsiveStyles;
}

function fieldTarget(type: string, styles: any = {}, properties: any = {}) {
  return targets(type, styles, properties).getTarget('field', true);
}

function placeholderTarget(type: string, styles: any = {}) {
  return targets(type, styles, { placeholder: 'Name' }).getTarget(
    'placeholder',
    true
  );
}

describe('input box inner padding', () => {
  it('applies uploader padding to the input of each input-box field', () => {
    const types = [
      'text_field',
      'text_area',
      'email',
      'password',
      'phone_number',
      'date_selector',
      'dropdown',
      'gmap_line_1'
    ];

    types.forEach((type) => {
      expect([type, fieldTarget(type, PADDING)]).toEqual([
        type,
        expect.objectContaining({
          paddingTop: '20px',
          paddingRight: '21px',
          paddingBottom: '22px',
          paddingLeft: '23px'
        })
      ]);
    });
  });

  it('leaves the input padding alone when the theme has no values', () => {
    // resetStyles supplies the padding in that case, so emitting zeroes here
    // would restyle every form authored before these keys existed.
    const target = fieldTarget('text_field');

    expect(target).not.toHaveProperty('paddingTop');
    expect(target).not.toHaveProperty('paddingRight');
    expect(target).not.toHaveProperty('paddingBottom');
    expect(target).not.toHaveProperty('paddingLeft');
  });

  it('applies each side independently', () => {
    const target = fieldTarget('text_field', { uploader_padding_left: 30 });

    expect(target.paddingLeft).toBe('30px');
    expect(target).not.toHaveProperty('paddingTop');
  });

  it('does not touch fields that use uploader padding for another target', () => {
    // file_upload applies these keys to its dropzone and button_group to each
    // button, both later in applyFieldStyles.
    expect(fieldTarget('file_upload', PADDING)).not.toHaveProperty('paddingTop');

    const buttonGroup = fieldTarget('button_group', PADDING);
    expect(buttonGroup.padding).toBe('20px 21px 22px 23px');
    expect(buttonGroup).not.toHaveProperty('paddingTop');
  });

  it('does not apply to fields rendered without an input box', () => {
    ['select', 'multiselect', 'checkbox', 'dropdown_multi', 'slider'].forEach(
      (type) => {
        expect([type, fieldTarget(type, PADDING)]).toEqual([
          type,
          expect.not.objectContaining({ paddingTop: '20px' })
        ]);
      }
    );
  });

  it('moves the placeholder in with the input text', () => {
    expect(placeholderTarget('text_field', PADDING).insetInlineStart).toBe(
      '23px'
    );
  });

  it('keeps a single-line placeholder vertically centered', () => {
    // Placeholder positions it at top 50%; only the inline start follows.
    expect(placeholderTarget('text_field', PADDING)).not.toHaveProperty('top');
  });

  it('drops a text area placeholder to just below its top padding', () => {
    // 8px of padding is what the text area rendered with before this was
    // themeable, and its placeholder sat at 0.6rem -- 1.6px lower.
    expect(
      placeholderTarget('text_area', { uploader_padding_top: 8 }).top
    ).toBe('9.6px');
    expect(
      placeholderTarget('text_area', { uploader_padding_top: 40 }).top
    ).toBe('41.6px');
  });

  it('leaves the placeholder alone when the theme has no padding values', () => {
    const target = placeholderTarget('text_field');

    expect(target).not.toHaveProperty('insetInlineStart');
    expect(target).not.toHaveProperty('top');
  });

  it('lets a shrink_top placeholder keep its computed top padding', () => {
    const target = fieldTarget(
      'text_field',
      {
        ...PADDING,
        placeholder_transition: 'shrink_top',
        height: 60,
        height_unit: 'px',
        font_size: 16
      },
      { placeholder: 'Name' }
    );

    expect(target.paddingTop).toBe('20px');
    expect(target.paddingLeft).toBe('23px');
  });
});

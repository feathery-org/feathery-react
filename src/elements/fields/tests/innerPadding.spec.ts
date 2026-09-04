import ResponsiveStyles, {
  DEFAULT_MOBILE_BREAKPOINT,
  DROPDOWN_FIELDS,
  INPUT_BOX_ATTR,
  INPUT_BOX_FIELDS,
  MULTISELECT_FIELD,
  inputBoxAttrs
} from '../../styles';
import { applyFieldStyles } from '../index';
import { createSelectStyles } from '../DropdownMultiField/selectStyles';

// A theme nobody has touched carries none of the six keys -- they have no
// default at any level of the cascade, so there is nothing to inherit and
// nothing to strip. `untouched` is therefore the empty theme plus whatever
// resolution inputs (height, font size) a test needs, and every field it
// produces has to render exactly as it did before these keys were readable.
const untouched = (overrides: any = {}) => ({ ...overrides });

// The same geometry typed in by hand: pixel-identical to `untouched`, but the
// declarations are there. What tells the two apart is whether the renderer
// emits anything at all, which is what several tests below are about.
const LEGACY_BLOCK: Record<string, number> = { text_area: 8, dropdown_multi: 8 };

const legacy = (type: string, overrides: any = {}) => {
  const block = LEGACY_BLOCK[type] ?? 6;
  return {
    inner_padding_top: block,
    inner_padding_bottom: block,
    inner_padding_left: type === 'dropdown_multi' ? 8 : 12,
    // A dropdown's right padding is the border-to-chevron gap, so its legacy
    // value is the 10px an untouched chevron always kept -- as is a
    // multiselect's, which composes to its own 28px strip.
    inner_padding_right: [
      'dropdown',
      'gmap_state',
      'gmap_country',
      'dropdown_multi'
    ].includes(type)
      ? 10
      : 12,
    // A phone's left padding is the border-to-flag gap; an untouched flag sat
    // flush on the border.
    ...(type === 'phone_number' ? { inner_padding_left: 0 } : {}),
    content_horizontal_align: 'flex-start',
    content_vertical_align: 'center',
    ...overrides
  };
};

// A floating-label field nobody has touched. The reserve behind the pinned
// label is computed per render rather than stored, so the only values here are
// the ones it is computed from.
const shrinkUntouched = (height: number, overrides: any = {}) =>
  untouched({
    placeholder_transition: 'shrink_top',
    height,
    height_unit: 'px',
    font_size: 16,
    ...overrides
  });

const PADDING = {
  inner_padding_top: 20,
  inner_padding_right: 21,
  inner_padding_bottom: 22,
  inner_padding_left: 23
};

// Every theme carries these, and some field types read them unguarded.
const BASE_STYLES = { background_color: 'FFFFFFFF', flex_direction: 'row' };

// getTarget mutates the instance (and includeMobile deletes the media key),
// so build fresh targets per assertion rather than sharing an instance.
function targets(
  type: string,
  styles: any = {},
  properties: any = {},
  mobileStyles: any = {}
) {
  const element = {
    servar: { type, metadata: {} },
    properties,
    styles: { ...BASE_STYLES, ...styles },
    mobile_styles: mobileStyles
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

function boxTarget(type: string, styles: any = {}, properties: any = {}) {
  return targets(type, styles, properties).getTarget('sub-fc', true);
}

function valueContainerTarget(type: string, styles: any = {}) {
  return targets(type, styles).getTarget('valueContainer', true);
}

// A 60px box with 16px text: one line is 19.2px, so the content box is
// 60 - 6 - 6 = 48px and a top-aligned midline sits at 6 + 9.6 = 15.6px.
const SIZED = { height: 60, height_unit: 'px', font_size: 16 };

// Three repos carry their own copy of this list and nothing here can read the
// others, so pin this one literally: adding a field type has to come here too,
// and the backend's own coverage test
// (apps/robin/tests/test_style_serializers.py) pins its half.
describe('the input-box field type list', () => {
  it('is exactly the set the other repos mirror', () => {
    expect([...INPUT_BOX_FIELDS, MULTISELECT_FIELD].sort()).toEqual(
      [
        'date_selector',
        'dropdown',
        // Padded on the container react-select lays its chips out in rather
        // than on an input, but the same keys and the same control.
        'dropdown_multi',
        'email',
        'gmap_city',
        'gmap_country',
        'gmap_line_1',
        'gmap_line_2',
        'gmap_state',
        'gmap_zip',
        'integer_field',
        'password',
        'phone_number',
        'ssn',
        'text_area',
        'text_field',
        'url'
      ].sort()
    );
  });

  it('marks every one of them in the DOM for the builder to anchor on', () => {
    // The builder's padding band finds the box by this attribute rather than
    // walking each field's private nesting.
    [...INPUT_BOX_FIELDS, MULTISELECT_FIELD].forEach((type) => {
      expect([type, inputBoxAttrs(type)]).toEqual([
        type,
        { [INPUT_BOX_ATTR]: '' }
      ]);
    });
    // The types that spend inner_padding_* on another sub-element are not
    // input boxes and must not claim the marker.
    ['file_upload', 'button_group', 'select', 'checkbox'].forEach((type) => {
      expect([type, inputBoxAttrs(type)]).toEqual([type, {}]);
    });
  });
});

describe('input box inner padding', () => {
  it('applies the inner padding to the input of each input-box field', () => {
    INPUT_BOX_FIELDS.forEach((type) => {
      expect([type, fieldTarget(type, PADDING)]).toEqual([
        type,
        expect.objectContaining({
          paddingTop: '20px',
          paddingBottom: '22px',
          // Inline sides are logical so the padding follows the form's
          // direction. A phone's left padding places its flag instead; the
          // number keeps its fixed 12px gap from it.
          // A phone's left padding places its flag instead; the number keeps
          // the fixed gap it has always had, pinned in the rem resetStyles
          // authors it as.
          paddingInlineStart: type === 'phone_number' ? '0.75rem' : '23px',
          // A dropdown's value stops a 20px chevron strip past the padding.
          paddingInlineEnd: DROPDOWN_FIELDS.includes(type) ? '41px' : '21px'
        })
      ]);
    });

    // The flag itself takes the left padding as its inset from the border.
    expect(
      targets('phone_number', PADDING).getTarget('fieldToggle', true)
        .marginInlineStart
    ).toBe('23px');
  });

  it('keeps the chevron strip clear of a dropdown value', () => {
    // The value always stops a 20px strip past the padding, so however small
    // the padding gets, a chevron never lands on the text.
    expect(
      fieldTarget('dropdown', { inner_padding_right: 60 }).paddingInlineEnd
    ).toBe('80px');
    expect(
      fieldTarget('dropdown', { inner_padding_right: 4 }).paddingInlineEnd
    ).toBe('24px');
    // Unset declares nothing, leaving the 30px inset the component itself
    // applies -- the same 10 + 20 a set padding composes to.
    expect(fieldTarget('dropdown', untouched())).not.toHaveProperty(
      'paddingInlineEnd'
    );
    // Typed in by hand, the legacy 10 composes back to exactly that inset.
    expect(
      fieldTarget('dropdown', legacy('dropdown')).paddingInlineEnd
    ).toBe('30px');
  });

  it('lands a dropdown chevron exactly a padding from the border', () => {
    // The right padding is the border-to-glyph gap, and the text stops a 20px
    // chevron strip further in.
    expect(
      fieldTarget('dropdown', { inner_padding_right: 60 })['--fe-chevron-x']
    ).toBe('60px');
    DROPDOWN_FIELDS.forEach((type) => {
      expect([
        type,
        fieldTarget(type, legacy(type))['--fe-chevron-x']
      ]).toEqual([type, '10px']);
    });

    // Zero padding, zero gap: the glyph sits on the border and the value
    // still keeps its strip from it.
    const flush = fieldTarget('dropdown', { inner_padding_right: 0 });
    expect(flush['--fe-chevron-x']).toBe('0px');
    expect(flush.paddingInlineEnd).toBe('20px');
  });

  it('lands a multiselect chevron on the same 10px gap', () => {
    expect(
      fieldTarget('dropdown_multi', legacy('dropdown_multi'))[
        '--fe-chevron-x'
      ]
    ).toBe('10px');
  });

  it('declares no chevron offset when the theme carries no padding', () => {
    // The components' own inline anchors keep the glyph where it has always
    // been, so the custom property is never introduced at all.
    DROPDOWN_FIELDS.concat('dropdown_multi').forEach((type) => {
      expect([type, fieldTarget(type)]).toEqual([
        type,
        expect.not.objectContaining({ '--fe-chevron-x': expect.anything() })
      ]);
    });
  });

  it('shifts the chevron clear of a tooltip trigger', () => {
    // The trigger occupies a 20px strip at the inline end, so the glyph sits
    // that much further in: the 10px gap plus the strip.
    expect(
      fieldTarget('dropdown', legacy('dropdown'), { tooltipText: 'help' })[
        '--fe-chevron-x'
      ]
    ).toBe('30px');
  });

  it('leaves the input padding alone when the theme has no values', () => {
    // resetStyles supplies the padding in that case, so emitting zeroes here
    // would restyle every form authored before these keys existed.
    const target = fieldTarget('text_field');

    expect(target).not.toHaveProperty('paddingTop');
    expect(target).not.toHaveProperty('paddingInlineEnd');
    expect(target).not.toHaveProperty('paddingBottom');
    expect(target).not.toHaveProperty('paddingInlineStart');
  });

  it('applies each side independently', () => {
    const target = fieldTarget('text_field', { inner_padding_left: 30 });

    expect(target.paddingInlineStart).toBe('30px');
    expect(target).not.toHaveProperty('paddingTop');
  });

  it('emits only logical inline sides, so an RTL form mirrors the padding', () => {
    INPUT_BOX_FIELDS.concat('dropdown_multi').forEach((type) => {
      const target = fieldTarget(type, PADDING);
      expect([type, 'paddingLeft' in target, 'paddingRight' in target]).toEqual(
        [type, false, false]
      );
    });
  });

  it('leaves the uploader padding namespace to the fields that own it', () => {
    // file_upload spends uploader_padding_* on its dropzone and button_group on
    // each button. Those keys keep meaning exactly that, and the inner padding
    // keys never reach them -- which is the whole reason for a fresh namespace.
    const UPLOADER = {
      uploader_padding_top: 20,
      uploader_padding_right: 21,
      uploader_padding_bottom: 22,
      uploader_padding_left: 23
    };

    expect(fieldTarget('button_group', UPLOADER).padding).toBe(
      '20px 21px 22px 23px'
    );
    expect(fieldTarget('button_group', PADDING).padding).not.toContain('20px');
    expect(fieldTarget('file_upload', PADDING)).not.toHaveProperty(
      'paddingTop'
    );

    // And the reverse: an input box ignores uploader_padding_* entirely, so a
    // theme that sets it for a dropzone cannot restyle a text field.
    const textField = fieldTarget('text_field', UPLOADER);
    expect(textField).not.toHaveProperty('paddingTop');
    expect(textField).not.toHaveProperty('paddingInlineStart');
  });

  // Every field subtype the theme declares a level_1 row for, minus the input
  // boxes. The six keys are writable on the level_2 `field` row -- the builder's
  // "Fields" button promotes them there, and the agent can set them there
  // directly -- and flatten_theme cascades a level_2 value onto *every* level_1
  // beneath it, not only the ones that can use it. So each of these really does
  // arrive carrying all six, and the renderer's type gate is the only thing
  // standing between "space every input box" and a checkbox or a signature pad
  // moving with them.
  const NON_INPUT_BOX_FIELDS = [
    'button_group',
    'checkbox',
    'custom',
    'file_upload',
    'hex_color',
    'json',
    'matrix',
    'multiselect',
    'payment_method',
    'pin_input',
    'qr_scanner',
    'rating',
    'select',
    'signature',
    'slider'
  ];

  it('does not apply to fields rendered without an input box', () => {
    const INNER_SPACING = {
      ...PADDING,
      content_horizontal_align: 'flex-end',
      content_vertical_align: 'flex-end'
    };
    const SPACING_PROPS = [
      'paddingTop',
      'paddingBottom',
      'paddingInlineStart',
      'paddingInlineEnd',
      'textAlign',
      'minHeight'
    ];

    NON_INPUT_BOX_FIELDS.forEach((type) => {
      const target = fieldTarget(type, { ...SIZED, ...INNER_SPACING });
      SPACING_PROPS.forEach((prop) => {
        expect([type, prop, prop in target]).toEqual([type, prop, false]);
      });
    });
  });

  it('leaves the two uploader-padding fields to their own sub-element', () => {
    // file_upload spends uploader_padding_* on its dropzone and button_group on
    // each button. Both are excluded from the input-box list for exactly that
    // reason, so a cascaded inner padding must not reach them.
    ['file_upload', 'button_group'].forEach((type) => {
      const target = fieldTarget(type, {
        ...SIZED,
        ...PADDING,
        uploader_padding_top: 7
      });
      expect([type, target.paddingTop]).toEqual([type, undefined]);
    });
  });

  it('pads a multiselect on its value container, not its input', () => {
    // react-select lays the chips out there; the input is a bare search box.
    expect(fieldTarget('dropdown_multi', PADDING)).not.toHaveProperty(
      'paddingTop'
    );
    expect(valueContainerTarget('dropdown_multi', PADDING)).toEqual(
      expect.objectContaining({
        paddingTop: '20px',
        paddingBottom: '22px',
        paddingInlineStart: '23px',
        // The right padding places the chevron; the chips carry a chevron
        // strip (18px) on top of it.
        paddingInlineEnd: '39px'
      })
    );
  });

  it('insets the chips a chevron strip past every right padding', () => {
    // One value drives the chevron and the chips together. A Math.max floor
    // here pinned the chevron in place for every padding below it, so small
    // paddings did nothing at all.
    [1, 4, 12, 24, 27, 40].forEach((r) => {
      expect([
        r,
        valueContainerTarget('dropdown_multi', { inner_padding_right: r })
          .paddingInlineEnd
      ]).toEqual([r, `${r + 18}px`]);
    });
  });

  it('keeps an empty caret out of a themed alignment', () => {
    // The caret is a flex item on the last line, so centring distributes free
    // space across the chips *and* it. It is invisible while empty, so its
    // width just pushes the chips off centre -- worst when react-select lets
    // it fill the rest of the line. `aligned` arrives resolved for the
    // viewport, so a mobile-only alignment reaches this path too.
    const inputStyle = (aligned: boolean, inputValue: string) =>
      (
        createSelectStyles({
          aligned,
          fontColor: '000000',
          menuZIndex: 1,
          responsiveStyles: targets('dropdown_multi'),
          rightToLeft: false
        }).input as any
      )({ flexGrow: 1 }, { selectProps: { inputValue } });

    // A 1px sliver rather than zero width, so the caret stays visible -- and
    // the inner input, sized inline by react-select, is constrained with it.
    expect(inputStyle(true, '')).toEqual(
      expect.objectContaining({
        flexGrow: 0,
        maxWidth: '1px',
        width: '1px',
        minWidth: '1px',
        overflow: 'hidden',
        '> input': { width: '1px', minWidth: '1px' }
      })
    );

    // Typing earns the space back.
    expect(inputStyle(true, 'opt')).toEqual({ flexGrow: 1 });

    // Packed from the start, a trailing caret changes nothing, so it keeps
    // whatever react-select gave it.
    expect(inputStyle(false, '')).toEqual({ flexGrow: 1 });
  });

  it('keeps a collapsed chip at its natural width', () => {
    // Squeezed narrower than its label, a chip wrapped it onto two or three
    // lines and the row read as a stack of fragments. Inner padding takes its
    // width out of the same space, so that had become the common case. The
    // count indicator absorbs whatever no longer fits instead.
    const multiValue = (collapseSelected: boolean) =>
      (
        createSelectStyles({
          aligned: false,
          fontColor: '000000',
          menuZIndex: 1,
          responsiveStyles: targets('dropdown_multi'),
          rightToLeft: false
        }).multiValue as any
      )({ minWidth: 0 }, { selectProps: { collapseSelected } });

    // react-select's own min-width comes through untouched; flex-shrink is
    // what decides, and it holds the chip whatever the min-width allows.
    expect(multiValue(true)).toEqual(
      expect.objectContaining({ flexShrink: 0, maxWidth: '100%' })
    );

    // Uncollapsed, react-select's own layout is left alone.
    expect(multiValue(false)).toEqual({ minWidth: 0 });
  });

  it('keeps an untouched multiselect exactly where it was', () => {
    // Nothing is declared, so selectStyles' own paddingInlineEnd stands: the
    // 28px chip inset straight from react-select.
    expect(valueContainerTarget('dropdown_multi')).not.toHaveProperty(
      'paddingInlineEnd'
    );
    // Typed in by hand, the same rule composes back to it: a 10px chevron gap
    // plus the 18px strip.
    expect(
      valueContainerTarget('dropdown_multi', legacy('dropdown_multi'))
        .paddingInlineEnd
    ).toBe('28px');
  });

  it('moves the placeholder in with the input text', () => {
    INPUT_BOX_FIELDS.forEach((type) => {
      // A phone's left padding places its flag; the number and its
      // placeholder keep their fixed 12px gap from it.
      const inset = type === 'phone_number' ? '12px' : '23px';
      expect([type, placeholderTarget(type, PADDING).insetInlineStart]).toEqual(
        [type, inset]
      );
    });
  });

  it('leaves the placeholder of a field whose input keeps its own padding', () => {
    // payment_method's inset belongs to Stripe's card element.
    expect(placeholderTarget('payment_method', PADDING)).toEqual(
      expect.not.objectContaining({ insetInlineStart: '23px' })
    );
  });

  it('keeps a single-line placeholder centered in the content box', () => {
    // The input centers its text between the paddings, so the placeholder's
    // 50% anchor shifts by half the top/bottom difference.
    expect(
      placeholderTarget('text_field', {
        inner_padding_top: 116,
        inner_padding_bottom: 6
      }).top
    ).toBe('calc(50% + 55px)');

    // An unset side falls back to the 6px resetStyles padding.
    expect(
      placeholderTarget('text_field', { inner_padding_bottom: 30 }).top
    ).toBe('calc(50% - 12px)');
  });

  it('leaves a symmetrically padded single-line placeholder at 50%', () => {
    // 50% is what Placeholder declares inline for an input, so emitting it is
    // a no-op -- and emitted rather than omitted so a mobile override can take
    // an asymmetrically padded placeholder back to the box centre.
    expect(
      placeholderTarget('text_field', {
        inner_padding_top: 20,
        inner_padding_bottom: 20
      }).top
    ).toBe('50%');
  });

  it('drops a text area placeholder to just below its top padding', () => {
    // 8px of padding is what the text area rendered with before this was
    // themeable, and its placeholder sat at 0.6rem -- 1.6px lower.
    expect(
      placeholderTarget('text_area', { inner_padding_top: 8 }).top
    ).toBe('9.6px');
    expect(
      placeholderTarget('text_area', { inner_padding_top: 40 }).top
    ).toBe('41.6px');
  });

  it('leaves the placeholder alone when the theme has no padding values', () => {
    const target = placeholderTarget('text_field');

    expect(target).not.toHaveProperty('insetInlineStart');
    // Nothing is declared either way, so Placeholder's own inline anchors --
    // the 50% and 0.75rem it carries -- are what place the label.
    expect(target).not.toHaveProperty('top');
  });

  it('renders a pinned top mode padding raw, exactly as stored', () => {
    // The default 'top' position: the shrunken label is a fixed overlay the
    // padding never moves, so the stored value renders as-is -- measured from
    // the box top like any other field, no reserve and no floor.
    const styles = (t: number) => ({
      ...PADDING,
      inner_padding_top: t,
      placeholder_transition: 'shrink_top',
      height: 90,
      height_unit: 'px',
      font_size: 16
    });
    (
      [
        [0, '0px'],
        [6, '6px'],
        [20, '20px'],
        [40, '40px']
      ] as [number, string][]
    ).forEach(([t, expected]) => {
      expect([
        t,
        fieldTarget('text_field', styles(t), { placeholder: 'Name' })
          .paddingTop
      ]).toEqual([t, expected]);
    });

    // At 0 the value renders behind the label's ink -- allowed by design, and
    // the overlay keeps its own fixed offsets.
    const zero = fieldTarget('text_field', styles(0), { placeholder: 'Name' });
    expect(zero.paddingBottom).toBe('22px');
    expect(zero.paddingInlineStart).toBe('23px');
    const focus = targets('text_field', styles(0), {
      placeholder: 'Name'
    }).getTarget('placeholderFocus', true);
    expect(focus.top).toBe(0);
    expect(focus.marginTop).toBe('5px');
    expect(focus.insetInlineStart).toBe('0.75rem');
  });

  it('holds the raw pinned padding at any height unit', () => {
    // No reserve means nothing to resolve against a height: the stored value
    // renders raw whether the box is pixels or a percentage.
    expect(
      fieldTarget(
        'text_field',
        {
          ...PADDING,
          inner_padding_top: 0,
          placeholder_transition: 'shrink_top',
          height: 100,
          height_unit: '%',
          font_size: 16
        },
        { placeholder: 'Name' }
      ).paddingTop
    ).toBe('0px');
  });

  it('computes the reserve production drew when no top padding is set', () => {
    // The room behind a pinned label is what the label occupies: its marginTop
    // (half the shrunken font) plus its line box, which inherits the field's
    // font size. At 16px that is 5 + 16 = 21, whatever the box height.
    (
      [
        ['text_field', 60, '21px'], // min(16,10)/2 + 16
        ['text_field', 90, '21px'], // the label does not grow with the box
        ['text_area', 60, '25px'] // minFontSize 10 * 2.5, its own geometry
      ] as [string, number, string][]
    ).forEach(([type, height, expected]) => {
      const styles = shrinkUntouched(height);
      expect([
        type,
        height,
        fieldTarget(type, styles, { placeholder: 'Name' }).paddingTop
      ]).toEqual([type, height, expected]);
      // And nothing clamps the box: an untouched field asks for no floor.
      expect([
        type,
        boxTarget(type, styles, { placeholder: 'Name' })
      ]).toEqual([type, expect.not.objectContaining({ minHeight: '0px' })]);
    });
  });

  it('holds the reserve steady as the builder changes the height', () => {
    // The label's footprint does not change with the box, so neither does the
    // room behind it. This used to be height/3, which drifted: at 500px it
    // reserved 167px and left the value 80px below the box's centre.
    const reserveAt = (height: number) =>
      fieldTarget('text_field', shrinkUntouched(height), {
        placeholder: 'Name'
      }).paddingTop;

    expect([reserveAt(60), reserveAt(120), reserveAt(500)]).toEqual([
      '21px',
      '21px',
      '21px'
    ]);

    // Clamped where the box has less room to give than the label wants, so a
    // short field still fits a line of text: 40 - 19.2 - 6 = 14.8, rounded.
    // Whole pixels because the builder stores this in an integer column, so a
    // fractional reserve would be a number it could only seed by rounding --
    // see the case table in feathery-frontend's boxSpacingHelper.spec.ts.
    expect(reserveAt(40)).toBe('15px');

    // A percentage box has no pixel height to clamp against, so the footprint
    // stands on its own -- and in px, because that is what the label is.
    expect(
      fieldTarget('text_field', shrinkUntouched(90, { height_unit: '%' }), {
        placeholder: 'Name'
      }).paddingTop
    ).toBe('21px');
  });

  it('keeps the multiselect control reserve production drew', () => {
    // A multiselect's themed padding lands on react-select's value container,
    // so the control itself carries the label's reserve. Untouched, that
    // reserve is all there is.
    const shrinkStyles = (overrides: any = {}) => ({
      ...shrinkUntouched(60),
      ...overrides
    });

    expect(
      fieldTarget('dropdown_multi', shrinkStyles(), { placeholder: 'Pick' })
        .paddingTop
    ).toBe('21px');

    // Once the container carries a padding, the larger of the two wins: a
    // container padding must not shrink the label's room.
    expect(
      fieldTarget('dropdown_multi', shrinkStyles({ inner_padding_top: 8 }), {
        placeholder: 'Pick'
      }).paddingTop
    ).toBe('max(8px, 21px)');
  });

  it('keeps the plain reserve on a field whose input owns its padding', () => {
    // payment_method's inner padding belongs to Stripe's card element, so it
    // is not an input-box type and never takes these keys. The reserve stays
    // the plain height/3 it always rendered with, whatever a theme happens to
    // store under the key.
    expect(
      fieldTarget(
        'payment_method',
        {
          inner_padding_top: 50,
          placeholder_transition: 'shrink_top',
          height: 60,
          height_unit: 'px',
          font_size: 16
        },
        { placeholder: 'Card' }
      ).paddingTop
    ).toBe('21px');
  });
});

describe('input box content alignment', () => {
  it('aligns the input text horizontally on every input-box field', () => {
    const cases: [string, string][] = [
      ['center', 'center'],
      ['flex-end', 'end']
    ];

    INPUT_BOX_FIELDS.forEach((type) => {
      cases.forEach(([align, textAlign]) => {
        expect([
          type,
          align,
          fieldTarget(type, { content_horizontal_align: align })
        ]).toEqual([type, align, expect.objectContaining({ textAlign })]);
      });
    });
  });

  it('emits the neutral start for start-aligned text', () => {
    // 'start' is what input, select and textarea already compute from the UA
    // stylesheet, so declaring it moves no text -- including PhoneField's
    // dir='ltr' input inside an RTL form, which computes start today too.
    // Emitted rather than omitted so a mobile override can take a centred or
    // end-aligned field back to the start; apply() can only merge, never
    // delete, so an omitted value would leave the desktop declaration standing
    // inside the breakpoint.
    INPUT_BOX_FIELDS.forEach((type) => {
      expect([
        type,
        fieldTarget(type, { content_horizontal_align: 'flex-start' }).textAlign
      ]).toEqual([type, 'start']);
    });
  });

  it('spans the placeholder across the input when text is not start-aligned', () => {
    // Anchoring one edge can't place centered or end-aligned text.
    const centered = placeholderTarget('text_field', {
      ...PADDING,
      content_horizontal_align: 'center'
    });

    expect(centered.insetInlineStart).toBe('23px');
    expect(centered.insetInlineEnd).toBe('21px');
    expect(centered.textAlign).toBe('center');
  });

  it('keeps a start-aligned placeholder anchored to one edge', () => {
    const started = placeholderTarget('text_field', {
      ...PADDING,
      content_horizontal_align: 'flex-start'
    });

    expect(started.insetInlineStart).toBe('23px');
    // 'auto' is the initial value, so the span is genuinely off -- emitted so a
    // mobile override can un-span a centred placeholder.
    expect(started.insetInlineEnd).toBe('auto');
  });

  it('stops a spanning dropdown placeholder a chevron strip past the padding', () => {
    const target = placeholderTarget('dropdown', {
      ...PADDING,
      content_horizontal_align: 'center'
    });

    // The 21px padding places the glyph; the text stops 20 further in.
    expect(target.insetInlineEnd).toBe('41px');
  });

  it('pads out the far side to align the input text vertically', () => {
    const top = fieldTarget('text_field', {
      ...SIZED,
      content_vertical_align: 'flex-start'
    });
    // 60 - 6 (top padding) - 19.2 (a line) leaves the rest below the text.
    expect(top.paddingBottom).toBe('34.8px');

    const bottom = fieldTarget('text_field', {
      ...SIZED,
      content_vertical_align: 'flex-end'
    });
    expect(bottom.paddingTop).toBe('34.8px');
  });

  it('moves the placeholder to the same line as the aligned input text', () => {
    expect(
      placeholderTarget('text_field', {
        ...SIZED,
        content_vertical_align: 'flex-start'
      }).top
    ).toBe('15.6px');

    expect(
      placeholderTarget('text_field', { ...SIZED, content_vertical_align: 'flex-end' })
        .top
    ).toBe('44.4px');
  });

  it('aligns against the padded-out height so the text stays in the box', () => {
    // Padding alone exceeds the themed height, so the box grows to 100px and
    // bottom-aligned text must sit against that, not the 60px it was given.
    const styles = {
      ...SIZED,
      inner_padding_top: 40,
      inner_padding_bottom: 40,
      content_vertical_align: 'flex-end'
    };

    expect(boxTarget('text_field', styles).minHeight).toBe('99.2px');
    expect(fieldTarget('text_field', styles).paddingTop).toBe('40px');
    expect(placeholderTarget('text_field', styles).top).toBe('49.6px');
  });

  it('leaves the vertical placement alone when it cannot be resolved', () => {
    // A percentage height has no pixel value to pad against, and a text area
    // already starts its text at the top padding.
    const percent = fieldTarget('text_field', {
      ...SIZED,
      height_unit: '%',
      content_vertical_align: 'flex-start'
    });
    expect(percent).not.toHaveProperty('paddingBottom');

    const textArea = fieldTarget('text_area', {
      ...SIZED,
      content_vertical_align: 'flex-start'
    });
    expect(textArea).not.toHaveProperty('paddingBottom');
  });

  it('aligns the value behind the raw padding under a pinned label', () => {
    // 'top' mode: the label is a fixed overlay, so alignment moves the value
    // behind the theme's raw padding, exactly as it would without a label.
    const styles = {
      ...SIZED,
      content_vertical_align: 'flex-end',
      placeholder_transition: 'shrink_top'
    };
    // The value drops to the bottom: 60 - 6 - 19.2 above it...
    expect(
      fieldTarget('text_field', styles, { placeholder: 'Name' }).paddingTop
    ).toBe('34.8px');
    // ...the resting label follows it down...
    expect(placeholderTarget('text_field', styles).top).toBe(
      `${60 - 6 - 19.2 / 2}px`
    );
    // ...and the shrunken label stays pinned to the box top.
    expect(
      targets('text_field', styles, { placeholder: 'Name' }).getTarget(
        'placeholderFocus',
        true
      ).top
    ).toBe(0);

    // Top-aligned with no stored top padding, the value stops at the reserve
    // the pinned label needs rather than at the raw 6px: an alignment is not a
    // statement about padding, so it cannot cancel the room the label occupies.
    // Running the value under the label's ink stays available -- but only by
    // storing inner_padding_top explicitly, which the test above covers.
    // The label's own footprint: min(16, 10) / 2 + 16.
    const reserve = 21;
    const topAligned = { ...styles, content_vertical_align: 'flex-start' };
    expect(placeholderTarget('text_field', topAligned).top).toBe(
      `${reserve + 19.2 / 2}px`
    );
    const topField = fieldTarget('text_field', topAligned, {
      placeholder: 'Name'
    });
    // Both sides, so the reserve that places the value is pinned directly and
    // not merely inferred from what is left below it.
    expect(topField.paddingTop).toBe(`${reserve}px`);
    expect(topField.paddingBottom).toBe(`${60 - reserve - 19.2}px`);
  });

  it('leaves an untouched floating-label field where centring finds it', () => {
    // The bug this rule exists for. A floating-label field renders its value a
    // little below the box midline, because the pinned label needs the room
    // above it -- and that offset is the placement, not an accident. Choosing
    // 'middle' therefore has to be a no-op on a field whose padding nobody
    // touched; otherwise it re-centres the value into the label and no option
    // in the panel can put it back.
    const base = { ...SIZED, placeholder_transition: 'shrink_top' };
    const untouchedField = fieldTarget('text_field', base, {
      placeholder: 'Name'
    });
    const centred = fieldTarget(
      'text_field',
      { ...base, content_vertical_align: 'center' },
      { placeholder: 'Name' }
    );
    expect(centred.paddingTop).toBe(untouchedField.paddingTop);
    expect(centred.paddingTop).toBe('21px');

    // ...and so does the resting label. The reserve moves the value, never the
    // label: untouched, nothing is emitted and Placeholder's own inline 50%
    // stands; centred, the same 50% is emitted explicitly so a mobile override
    // can undo a synthesized offset. Different declarations, identical pixels
    // -- which is the point, since the label is what the user is looking at.
    expect(placeholderTarget('text_field', base)).not.toHaveProperty('top');
    expect(
      placeholderTarget('text_field', {
        ...base,
        content_vertical_align: 'center'
      }).top
    ).toBe('50%');
  });

  it('holds the no-op where the clamp drives the reserve under the reset', () => {
    // A box short enough that the label wants more room than it has: at 40px
    // with a 30px line the reserve clamps to 4px, below the 6px block reset.
    // Flooring the aligned padding back up to the reset undid that clamp --
    // 6 + 30 + 6 needs 42px of a 40px field -- and left the centred value 2px
    // below where the untouched field renders it, so the reserve stands as the
    // clamp left it.
    const squeezed = {
      placeholder_transition: 'shrink_top',
      height: 40,
      height_unit: 'px',
      font_size: 16,
      line_height: 30
    };
    const untouchedTop = fieldTarget('text_field', squeezed, {
      placeholder: 'Name'
    }).paddingTop;

    expect(untouchedTop).toBe('4px');
    expect(
      fieldTarget(
        'text_field',
        { ...squeezed, content_vertical_align: 'center' },
        { placeholder: 'Name' }
      ).paddingTop
    ).toBe(untouchedTop);
  });

  it('keeps the production label offsets outside a unit', () => {
    const focus = targets(
      'text_field',
      {
        ...untouched(),
        ...SIZED,
        placeholder_transition: 'shrink_top'
      },
      { placeholder: 'Name' }
    ).getTarget('placeholderFocus', true);
    expect(focus.top).toBe(0);
    expect(focus.marginTop).toBe('5px');
    expect(focus).not.toHaveProperty('lineHeight');
  });
});

describe('multiselect content alignment', () => {
  it('aligns the chips with flexbox instead of synthesizing an offset', () => {
    // The value container is already a flex container, so both axes take the
    // stored value directly -- and it holds at any height unit.
    expect(
      valueContainerTarget('dropdown_multi', { content_vertical_align: 'flex-start' })
    ).toEqual(
      expect.objectContaining({
        alignItems: 'flex-start',
        alignContent: 'flex-start'
      })
    );

    expect(
      valueContainerTarget('dropdown_multi', {
        height: 60,
        height_unit: '%',
        content_vertical_align: 'flex-end'
      })
    ).toEqual(
      expect.objectContaining({
        alignItems: 'flex-end',
        alignContent: 'flex-end'
      })
    );
  });

  it('fills the control so there is a box to inset and align within', () => {
    // react-select centers a content-sized value container on the control, so
    // padding would grow a floating box and alignment would have no room.
    expect(
      valueContainerTarget('dropdown_multi', { inner_padding_top: 20 })
        .alignSelf
    ).toBe('stretch');
    expect(
      valueContainerTarget('dropdown_multi', { content_vertical_align: 'flex-end' })
        .alignSelf
    ).toBe('stretch');
  });

  it('leaves an untouched multiselect hugging its content', () => {
    // Nothing declared at all, so react-select's own layout decides where the
    // chips sit -- stretching the container would move every existing one.
    const target = valueContainerTarget('dropdown_multi');
    expect(target).not.toHaveProperty('alignSelf');
    expect(target).not.toHaveProperty('alignItems');
    expect(target).not.toHaveProperty('justifyContent');
  });

  it('stretches the container once the theme asks for any placement', () => {
    // Honoring a placement needs a box to distribute within, and a container
    // that hugs its content has none -- so an explicit centre stretches it too,
    // even though centring is what react-select already did. That only reaches
    // a multiselect somebody edited: absent keys never get here.
    ['inner_padding_top', 'content_vertical_align'].forEach((key) => {
      const value = key === 'inner_padding_top' ? 8 : 'center';
      expect([key, valueContainerTarget('dropdown_multi', { [key]: value })
        .alignSelf]).toEqual([key, 'stretch']);
    });
  });

  it('rides the chevron down to the chips it belongs to', () => {
    // Painted on the box, so without this it floats at the box's midline while
    // the chips sit wherever the padding and alignment put them.
    expect(
      fieldTarget('dropdown_multi', {
        ...SIZED,
        content_vertical_align: 'flex-start',
        inner_padding_top: 20
      }).backgroundPositionY
    ).toBe('29.6px');

    expect(
      fieldTarget('dropdown_multi', {
        ...SIZED,
        content_vertical_align: 'flex-end',
        inner_padding_bottom: 20
      }).backgroundPositionY
    ).toBe('calc(100% - 29.6px)');

    // A single dropdown's value is centred in its content box, so the chevron
    // takes the same shift the text does.
    expect(
      fieldTarget('dropdown', {
        ...SIZED,
        inner_padding_top: 40,
        inner_padding_bottom: 6
      }).backgroundPositionY
    ).toBe('calc(50% + 17px)');
  });

  it('centres the chevron on the padded area, not on the box', () => {
    // Centred is what the box does with no content_vertical_align, so this is
    // the common case: an uneven padding moves the chips off the box's midline,
    // and the chevron has to follow them there rather than sit halfway down.
    const styles = {
      ...SIZED,
      inner_padding_top: 101,
      inner_padding_bottom: 0
    };

    expect(fieldTarget('dropdown_multi', styles).backgroundPositionY).toBe(
      'calc(50% + 50.5px)'
    );
    // Placed off the same value, so the two can't disagree.
    expect(placeholderTarget('dropdown_multi', styles).top).toBe(
      'calc(50% + 50.5px)'
    );
  });

  it('centres a half-set padding against the multiselect legacy 8px', () => {
    // The unset bottom falls back to the 8px a multiselect rendered with, not
    // a plain input's 6px, so the shift is (28 - 8) / 2 = 10.
    const styles = { ...SIZED, inner_padding_top: 28 };

    expect(fieldTarget('dropdown_multi', styles).backgroundPositionY).toBe(
      'calc(50% + 10px)'
    );
    expect(placeholderTarget('dropdown_multi', styles).top).toBe(
      'calc(50% + 10px)'
    );
  });

  it('leaves the chevron alone when the padding is even', () => {
    // 'center' is what both components declare inline before spreading the
    // field target, so the glyph does not move; emitted rather than omitted so
    // a mobile override can bring it back to the box midline.
    expect(fieldTarget('dropdown_multi', SIZED)).not.toHaveProperty(
      'backgroundPositionY'
    );
    expect(
      fieldTarget('dropdown_multi', {
        ...SIZED,
        inner_padding_top: 20,
        inner_padding_bottom: 20
      }).backgroundPositionY
    ).toBe('center');
  });

  it('distributes the chips horizontally', () => {
    expect(
      valueContainerTarget('dropdown_multi', { content_horizontal_align: 'center' })
    ).toEqual(
      expect.objectContaining({ justifyContent: 'center', textAlign: 'center' })
    );

    // flex-start is how a flex container distributes with no declaration at
    // all (initial 'normal' behaves as flex-start), so emitting it changes
    // nothing -- and lets a mobile override undo a centred desktop.
    expect(
      valueContainerTarget('dropdown_multi', { content_horizontal_align: 'flex-start' })
        .justifyContent
    ).toBe('flex-start');
  });

  it('moves the multiselect placeholder onto the chip line', () => {
    expect(
      placeholderTarget('dropdown_multi', {
        ...SIZED,
        content_vertical_align: 'flex-start',
        inner_padding_top: 20
      }).top
    ).toBe('29.6px');

    expect(
      placeholderTarget('dropdown_multi', {
        ...SIZED,
        content_vertical_align: 'flex-end',
        inner_padding_bottom: 20
      }).top
    ).toBe('calc(100% - 29.6px)');
  });

  it('spans the multiselect placeholder clear of its chevron', () => {
    const target = placeholderTarget('dropdown_multi', {
      ...PADDING,
      content_horizontal_align: 'center'
    });

    // It keeps its production 4px offset inside the chips' 23px inline start.
    expect(target.insetInlineStart).toBe('27px');
    // It stands in for the chips, so it stops where they do: the 21px right
    // padding plus the 18px chevron strip.
    expect(target.insetInlineEnd).toBe('39px');
    expect(target.textAlign).toBe('center');
  });
});

describe('input box minimum height', () => {
  it('grows the box to fit its padding and a line of text', () => {
    expect(
      boxTarget('text_field', {
        ...SIZED,
        inner_padding_top: 50,
        inner_padding_bottom: 10
      }).minHeight
    ).toBe('79.2px');
  });

  it('keeps the percentage-height floor when it is larger', () => {
    expect(
      boxTarget('text_field', {
        height: 100,
        height_unit: '%',
        font_size: 16,
        inner_padding_top: 6,
        inner_padding_bottom: 20
      }).minHeight
    ).toBe('50px');
  });

  it('leaves the box alone when the theme has no inner padding', () => {
    // 'auto' is the initial min-height, so the box is governed by its height
    // alone -- emitted rather than omitted so a mobile override that lowers a
    // raised padding can let the box shrink back.
    expect(boxTarget('text_field', SIZED)).not.toHaveProperty('minHeight');
  });

  it('leaves the box alone at the padding the field already rendered with', () => {
    // 6/6 is what a text field already rendered with, and an unset side falls
    // back to it, so the clamp has to key on a padding *raised* above that --
    // otherwise it would grow every box that exists today.
    expect(
      boxTarget('text_field', {
        ...SIZED,
        inner_padding_top: 6,
        inner_padding_bottom: 6
      }).minHeight
    ).toBe('auto');

    expect(
      boxTarget('text_area', {
        ...SIZED,
        inner_padding_top: 8,
        inner_padding_bottom: 8
      }).minHeight
    ).toBe('auto');

    // A multiselect keeps the plain height floor applyHeight gave it, with no
    // padding added on top.
    expect(
      boxTarget('dropdown_multi', {
        ...SIZED,
        inner_padding_top: 8,
        inner_padding_bottom: 8
      }).minHeight
    ).toBe('60px');
  });

  it('ignores a padding lowered below what the field rendered with', () => {
    // Less padding never needs more room, so it can only ever count up.
    expect(
      boxTarget('text_field', {
        ...SIZED,
        inner_padding_top: 0,
        inner_padding_bottom: 0
      }).minHeight
    ).toBe('auto');
  });

  it('adds a multiselect padding to its height rather than eating into it', () => {
    // Its height is a floor so the box can grow with the chips, which makes it
    // the content area: every pixel of padding has to widen the box, or the
    // first (height - line) of it would only push the chips down.
    expect(
      boxTarget('dropdown_multi', {
        ...SIZED,
        inner_padding_top: 50,
        inner_padding_bottom: 10
      }).minHeight
    ).toBe('120px');

    // A height smaller than a line of text still fits one.
    expect(
      boxTarget('dropdown_multi', {
        height: 10,
        height_unit: 'px',
        font_size: 16,
        inner_padding_top: 20,
        inner_padding_bottom: 0
      }).minHeight
    ).toBe('39.2px');
  });

  it('fills what a label leaves once the padding or alignment moves', () => {
    // A percentage measures the box from the element's top, so a label above
    // it made the box that much too tall -- and dropped the chips, the
    // placeholder and the chevron centred in it by half the label. The fix
    // needs the element restructured into a column, so it is spent only when
    // the theme moves the padding or alignment.
    const PERCENT = { height: 100, height_unit: '%', font_size: 16 };
    const moved = boxTarget(
      'dropdown_multi',
      untouched({ ...PERCENT, inner_padding_top: 20 })
    );

    // 'auto' is the initial height, so the box is sized by flexGrow alone.
    expect(moved.height).toBe('auto');
    expect(moved.flexGrow).toBe(1);

    // Untouched, the box keeps master's whole-element percentage, label
    // overflow deliberately included.
    const legacy = boxTarget(
      'dropdown_multi',
      untouched(PERCENT)
    );

    expect(legacy.height).toBe('100%');
    // 0 is the initial flex-grow, so the percentage height governs.
    expect(legacy.flexGrow).toBe(0);
  });
});

// The suites above set style keys and check what comes out. This one is about
// the other half of the design: a theme that sets none of them has to come out
// with nothing at all, because "nothing" is what every form rendering today
// resolves to and the legacy geometry lives in the components rather than in
// the data. Every property here is one that, if emitted, would move a field
// nobody has edited.
describe('an untouched theme emits no inner spacing at all', () => {
  const SPACING_PROPS = [
    'paddingTop',
    'paddingBottom',
    'paddingInlineStart',
    'paddingInlineEnd',
    'textAlign',
    'minHeight',
    'backgroundPositionY',
    'transform',
    '--fe-chevron-x'
  ];

  it('declares nothing on the box of any input-box field', () => {
    INPUT_BOX_FIELDS.concat('dropdown_multi').forEach((type) => {
      const target = fieldTarget(type, untouched(SIZED));
      SPACING_PROPS.forEach((prop) => {
        expect([type, prop, prop in target]).toEqual([type, prop, false]);
      });
    });
  });

  it('declares nothing on a multiselect value container', () => {
    const target = valueContainerTarget('dropdown_multi', untouched(SIZED));
    expect(target).toEqual({});
  });

  it('leaves a multiselect in the block layout it always had', () => {
    // The column restructure exists for a moved padding or alignment. Emitted
    // for an untouched theme it would change where existing labels and chips
    // render, so the element keeps the plain block it renders as today.
    const styles = targets('dropdown_multi', untouched(SIZED));
    const fc = styles.getTarget('fc', true);

    expect(fc).not.toHaveProperty('display');
    expect(fc).not.toHaveProperty('flexDirection');
    expect(fc).not.toHaveProperty('alignItems');
    expect(styles.getTarget('sub-fc', true)).not.toHaveProperty('flexShrink');
  });

  it('leaves the placeholder to the anchors the component declares', () => {
    ['text_field', 'text_area', 'dropdown_multi'].forEach((type) => {
      const target = placeholderTarget(type, untouched(SIZED));
      ['top', 'insetInlineStart', 'insetInlineEnd', 'textAlign'].forEach(
        (prop) => {
          expect([type, prop, prop in target]).toEqual([type, prop, false]);
        }
      );
    });
  });

  it('leaves the inline end icons and the flag where they sit', () => {
    expect(targets('ssn', untouched(SIZED)).getTarget('endIcon', true)).toEqual(
      {}
    );
    expect(
      targets('phone_number', untouched(SIZED)).getTarget('fieldToggle', true)
    ).toEqual(expect.not.objectContaining({ marginInlineStart: '0px' }));
  });

  it('holds for every height unit and a floating label', () => {
    // The resolution inputs a field always carries -- height, font size, a
    // shrink_top label -- must not be mistaken for intent on their own.
    (['px', '%', 'fit'] as const).forEach((unit) => {
      const target = fieldTarget('text_field', {
        ...shrinkUntouched(100),
        height: unit === 'fit' ? '' : 100,
        height_unit: unit
      });
      ['paddingTop', 'paddingBottom', 'textAlign'].forEach((prop) => {
        expect([unit, prop, prop in target]).toEqual([unit, prop, false]);
      });
    });
  });

  // The guarantee an existing form is judged by: turn the keys on in the
  // renderer and no label on any field moves. The resting label is reached by
  // nothing at all, so Placeholder's own inline anchors place it exactly as
  // they do today. The shrunken overlay's inline seat *is* re-declared, because
  // a mobile override has to be able to return the label to it and apply()
  // cannot undo a declaration -- so the value has to be that anchor to the
  // unit, not merely to the pixel at a 16px root.
  const LABEL_PLACEMENT_PROPS = [
    'top',
    'bottom',
    'insetInlineStart',
    'insetInlineEnd',
    'transform',
    'textAlign',
    'width'
  ];

  it('leaves every resting floating label to the anchors Placeholder carries', () => {
    INPUT_BOX_FIELDS.concat(MULTISELECT_FIELD).forEach((type) => {
      const resolved = targets(type, shrinkUntouched(56), {
        placeholder: 'Name'
      }).getTarget('placeholder', true);
      LABEL_PLACEMENT_PROPS.forEach((prop) => {
        expect([type, prop, prop in resolved]).toEqual([type, prop, false]);
      });
    });
  });

  it('re-seats every shrunken floating label on its own anchor, in rem', () => {
    // 0.75rem, not 12px: the same seat only at a 16px root, and a form on a
    // page with any other root size would have every shrunken label shift.
    INPUT_BOX_FIELDS.concat(MULTISELECT_FIELD).forEach((type) => {
      const resolved = targets(type, shrinkUntouched(56), {
        placeholder: 'Name'
      }).getTarget('placeholderFocus', true);
      expect([type, resolved.insetInlineStart]).toEqual([type, '0.75rem']);
      LABEL_PLACEMENT_PROPS.filter(
        (prop) => prop !== 'insetInlineStart' && prop !== 'top'
      ).forEach((prop) => {
        expect([type, prop, prop in resolved]).toEqual([type, prop, false]);
      });
      // top: 0 with a half-font marginTop is the pin production already drew.
      expect([type, resolved.top]).toEqual([type, 0]);
    });
  });
});

// The same geometry set explicitly: identical pixels, but now the renderer has
// been told, so it emits. Nothing here changes what a form looks like -- it
// pins that the emitted values compose back to the legacy ones, which is what
// makes the builder's controls land where the field already was.
describe('the legacy geometry typed in by hand', () => {
  it('composes back to the same box on every input-box field', () => {
    INPUT_BOX_FIELDS.forEach((type) => {
      const target = fieldTarget(type, legacy(type, SIZED));
      const block = type === 'text_area' ? '8px' : '6px';
      expect([type, target.paddingTop, target.paddingBottom]).toEqual([
        type,
        block,
        block
      ]);
      expect([type, target.paddingInlineEnd]).toEqual([
        type,
        DROPDOWN_FIELDS.includes(type) ? '30px' : '12px'
      ]);
      // 'start' is what the UA already computes for these elements, so the
      // declaration changes nothing.
      expect([type, target.textAlign]).toEqual([type, 'start']);
    });
  });

  it('reproduces the multiselect insets react-select already laid out', () => {
    // 8px inline start is react-select's own value-container padding, and 10 +
    // an 18px chevron strip is the 28px inset the chips always had.
    const target = valueContainerTarget(
      'dropdown_multi',
      legacy('dropdown_multi')
    );

    expect(target.paddingInlineStart).toBe('8px');
    expect(target.paddingInlineEnd).toBe('28px');
    expect(target.justifyContent).toBe('flex-start');
    expect(target.alignItems).toBe('center');
  });

  it('never clamps a box that fits its own padding', () => {
    INPUT_BOX_FIELDS.forEach((type) => {
      // 'auto' leaves the box governed by its own height, exactly as an
      // undeclared min-height does.
      expect([type, boxTarget(type, legacy(type, SIZED)).minHeight]).toEqual([
        type,
        'auto'
      ]);
    });
  });

  it('keeps the placeholder on the inset it always had', () => {
    expect(placeholderTarget('text_field', legacy('text_field'))).toEqual(
      expect.objectContaining({ insetInlineStart: '12px', top: '50%' })
    );
    // A text area's 9.6px is its 8px of padding plus the 1.6px the placeholder
    // always sat below it.
    expect(placeholderTarget('text_area', legacy('text_area')).top).toBe(
      '9.6px'
    );
    // A multiselect's placeholder sat at 12px too: 4px inside the chips' 8px
    // inline start.
    expect(
      placeholderTarget('dropdown_multi', legacy('dropdown_multi'))
        .insetInlineStart
    ).toBe('12px');
  });
});

describe('vertical alignment reach', () => {
  it('only resolves against a pixel height', () => {
    // The offset is synthesized as padding, and a percentage padding resolves
    // against width, so there is no CSS-only equivalent. 'fit' stores an empty
    // height, which is the same dead end.
    (['%', 'fit'] as const).forEach((unit) => {
      const target = fieldTarget('text_field', {
        ...untouched(),
        height: unit === 'fit' ? '' : 100,
        height_unit: unit,
        font_size: 16,
        content_vertical_align: 'flex-end'
      });

      // Nothing to synthesize and no padding behind it, so nothing is said at
      // all: resetStyles' own block padding stands.
      expect([unit, 'paddingTop' in target]).toEqual([unit, false]);
    });
  });

  it('holds for a multiselect at any height unit', () => {
    // Its chips are placed by flexbox, so no pixel height is needed.
    (['px', '%'] as const).forEach((unit) => {
      expect([
        unit,
        valueContainerTarget('dropdown_multi', {
          ...untouched(),
          height: 100,
          height_unit: unit,
          content_vertical_align: 'flex-end'
        }).alignItems
      ]).toEqual([unit, 'flex-end']);
    });
  });

  it('never synthesizes a negative padding', () => {
    // A box shorter than one line has nothing left to pad out.
    const target = fieldTarget('text_field', {
      height: 12,
      height_unit: 'px',
      font_size: 16,
      inner_padding_top: 0,
      inner_padding_bottom: 0,
      content_vertical_align: 'flex-start'
    });

    expect(target.paddingBottom).toBe('0px');
  });
});

describe('a floating label tracks the padding its value follows', () => {
  const SHRINK = {
    placeholder_transition: 'shrink_top',
    height: 56,
    height_unit: 'px',
    font_size: 16
  };
  it('leaves the resting label where it has always been at the defaults', () => {
    // Untouched, the value sits on the box centre exactly as it always did, so
    // the label must not move either -- nothing is declared, and the 50% anchor
    // Placeholder carries inline is what places it.
    expect(
      placeholderTarget('text_field', { ...untouched(), ...SHRINK })
    ).not.toHaveProperty('top');
    // Set to the same geometry by hand, it resolves back to that same anchor.
    expect(
      placeholderTarget('text_field', { ...legacy('text_field'), ...SHRINK })
        .top
    ).toBe('50%');
  });

  it('moves a pinned resting label on the raw value line', () => {
    // 'top' mode: the value centres between the raw paddings, so the resting
    // label -- standing in for it -- sits at 50% + (t - 6) / 2 over the legacy
    // 6px bottom an unset side falls back to, exactly as it would without a
    // floating label.
    (
      [
        [0, 'calc(50% - 3px)'],
        [12, 'calc(50% + 3px)'],
        [18, 'calc(50% + 6px)'],
        [40, 'calc(50% + 17px)']
      ] as [number, string][]
    ).forEach(([t, expected]) => {
      expect([
        t,
        placeholderTarget('text_field', {
          ...untouched(),
          ...SHRINK,
          inner_padding_top: t
        }).top
      ]).toEqual([t, expected]);
    });
  });

  it('pins the shrunken label on its own seat while the left padding moves', () => {
    const moved = targets(
      'text_field',
      {
        ...untouched(),
        ...SHRINK,
        inner_padding_left: 30
      },
      { placeholder: 'Name' }
    );
    // The resting label tracks the padding with the value it stands in
    // for...
    expect(moved.getTarget('placeholder', true).insetInlineStart).toBe('30px');
    // ...but the shrunken overlay keeps the production 0.75rem seat, in the
    // unit Placeholder anchors it with so a non-16px root cannot shift it.
    expect(moved.getTarget('placeholderFocus', true).insetInlineStart).toBe(
      '0.75rem'
    );
  });

  it('keeps a legacy-padded text area label at the inset it has always had', () => {
    // The resting label keeps its 1.6px offset off the raw 8px padding --
    // the 0.6rem it has always rendered at.
    expect(
      placeholderTarget('text_area', { ...legacy('text_area'), ...SHRINK }).top
    ).toBe('9.6px');
  });

  it('moves a pinned text area label with the raw padding', () => {
    // 'top' mode: the text starts at the raw top padding, and the resting
    // label keeps its 1.6px offset off that line -- including at 0, where it
    // runs under the shrunken label's ink by design.
    expect(
      placeholderTarget('text_area', {
        ...untouched(),
        ...SHRINK,
        inner_padding_top: 40
      }).top
    ).toBe(`${40 + 1.6}px`);
    const lowered = {
      ...untouched(),
      ...SHRINK,
      inner_padding_top: 0
    };
    expect(placeholderTarget('text_area', lowered).top).toBe('1.6px');
    expect(
      fieldTarget('text_area', lowered, { placeholder: 'Name' }).paddingTop
    ).toBe('0px');
  });

  it('keeps tracking the raw padding without a floating label', () => {
    expect(
      placeholderTarget('text_field', {
        ...untouched(),
        height: 56,
        height_unit: 'px',
        font_size: 16,
        inner_padding_top: 40
      }).top
    ).toBe('calc(50% + 17px)');
  });

  // The rules are keyed by type, so every single-line type has to come out
  // the same -- a per-type override anywhere would break one of these.
  const SINGLE_LINE = INPUT_BOX_FIELDS.filter((t) => t !== 'text_area');

  it('moves the label and value together for every single-line type', () => {
    SINGLE_LINE.forEach((type) => {
      // The raw 40 renders as-is and the value line -- with the resting label
      // on it -- sits at (40 - 6) / 2 over the legacy bottom.
      const pinned = {
        ...untouched(),
        ...SHRINK,
        inner_padding_top: 40
      };
      expect([type, placeholderTarget(type, pinned).top]).toEqual([
        type,
        'calc(50% + 17px)'
      ]);
      expect([
        type,
        fieldTarget(type, pinned, { placeholder: 'Name' }).paddingTop
      ]).toEqual([type, '40px']);

      // Untouched, the label keeps its production seat: nothing is declared,
      // so Placeholder's own 50% anchor places it.
      expect([
        type,
        'top' in placeholderTarget(type, { ...untouched(), ...SHRINK })
      ]).toEqual([type, false]);
    });
  });

  it('tracks the raw padding without a floating label for every single-line type', () => {
    SINGLE_LINE.forEach((type) => {
      expect([
        type,
        placeholderTarget(type, {
          ...untouched(),
          height: 56,
          height_unit: 'px',
          font_size: 16,
          inner_padding_top: 40,
          inner_padding_bottom: 0
        }).top
      ]).toEqual([type, 'calc(50% + 20px)']);
    });
  });
});

describe('inline end icons ride the padding', () => {
  const endIcon = (styles: any, properties: any = { placeholder: 'SSN' }) =>
    targets('ssn', styles, properties).getTarget('endIcon', true);

  it('keeps the production seat while the theme sets no padding', () => {
    // Nothing declared, so the component's own 8px anchor holds the icon.
    expect(endIcon(untouched())).not.toHaveProperty('insetInlineEnd');
    // The legacy 12px resolves back to that same seat.
    expect(endIcon(legacy('ssn')).insetInlineEnd).toBe('8px');
  });

  it('moves in and out with the right padding, never past the border', () => {
    expect(
      endIcon(untouched({ inner_padding_right: 40 })).insetInlineEnd
    ).toBe('36px');
    expect(
      endIcon(untouched({ inner_padding_right: 0 })).insetInlineEnd
    ).toBe('0px');
  });

  it('keeps its wider seat next to a tooltip', () => {
    const props = { placeholder: 'SSN', tooltipText: 'help' };
    expect(endIcon(legacy('ssn'), props).insetInlineEnd).toBe('30px');
    expect(
      endIcon(untouched({ inner_padding_right: 40 }), props)
        .insetInlineEnd
    ).toBe('58px');
  });

  it('rides the value line together with the tooltip trigger', () => {
    const styles = {
      ...untouched(),
      placeholder_transition: 'shrink_top',
      height: 56,
      height_unit: 'px',
      font_size: 16,
      inner_padding_top: 40
    };
    // The raw value line, (40 - 6) / 2 below the box centre. Both icons ride
    // it, computed from the same geometry so they cannot disagree.
    const pinned = targets('ssn', styles, { placeholder: 'SSN' });
    expect(pinned.getTarget('endIcon', true).transform).toBe(
      'translateY(17px)'
    );
    expect(pinned.getTarget('tooltipTrigger', true).transform).toBe(
      'translateY(17px)'
    );
  });

  it("shifts a dropdown tooltip off the chevron gap's own zero", () => {
    // A dropdown's legacy right padding is the 10px chevron gap, so setting it
    // by hand leaves the trigger at its production 10px seat.
    const trigger = (styles: any) =>
      targets('dropdown', styles, { placeholder: 'Pick' }).getTarget(
        'tooltipTrigger',
        true
      );
    expect(trigger(untouched())).not.toHaveProperty('insetInlineEnd');
    expect(trigger(legacy('dropdown')).insetInlineEnd).toBe('10px');
    expect(
      trigger(untouched({ inner_padding_right: 30 }))
        .insetInlineEnd
    ).toBe('30px');
  });
});

describe('a mobile padding override reaches the chevron', () => {
  const MOBILE_KEY = `@media (max-width: ${DEFAULT_MOBILE_BREAKPOINT}px)`;

  it('moves the glyph under the same media query as the padding', () => {
    // The offset is a custom property the theme emits, so apply() carries the
    // override into the breakpoint -- a value computed from the resolved
    // desktop target never could.
    const dropdown = targets(
      'dropdown',
      untouched(),
      {},
      { inner_padding_right: 24 }
    ).getTarget('field');

    // Desktop set nothing, so it declares nothing and the component's own
    // anchor holds the glyph there; only the breakpoint carries the offset.
    expect(dropdown).not.toHaveProperty('--fe-chevron-x');
    expect(dropdown[MOBILE_KEY]['--fe-chevron-x']).toBe('24px');
    // The value stops its 20px chevron strip past the same mobile padding.
    expect(dropdown[MOBILE_KEY].paddingInlineEnd).toBe('44px');
  });

  it('holds for a multiselect too', () => {
    const multi = targets(
      'dropdown_multi',
      untouched(),
      {},
      { inner_padding_right: 24 }
    ).getTarget('field');

    expect(multi).not.toHaveProperty('--fe-chevron-x');
    expect(multi[MOBILE_KEY]['--fe-chevron-x']).toBe('24px');
  });
});

describe('a phone flag rides its number', () => {
  const SHRINK = {
    placeholder_transition: 'shrink_top',
    height: 56,
    height_unit: 'px',
    font_size: 16
  };
  const flagTarget = (styles: any) =>
    targets('phone_number', styles, { placeholder: 'Phone' }).getTarget(
      'fieldToggle',
      true
    );

  it('stays centred on the box while the padding is untouched', () => {
    // 'none' is the initial value, so the flag contains and stacks exactly as
    // it does undeclared -- a zero translation would still create a stacking
    // context and a containing block. Emitted so a mobile override can
    // re-centre a moved flag.
    expect(
      flagTarget({ ...untouched(), ...SHRINK }).transform
    ).toBe('none');
  });

  it('rides the value line under a floating label', () => {
    // The raw value line, (40 - 6) / 2 below the box centre.
    expect(
      flagTarget({
        ...untouched(),
        ...SHRINK,
        inner_padding_top: 40
      }).transform
    ).toBe('translateY(17px)');
  });

  it('rides the raw padding without a floating label', () => {
    expect(
      flagTarget({
        ...untouched(),
        height: 56,
        height_unit: 'px',
        font_size: 16,
        inner_padding_top: 40,
        inner_padding_bottom: 0
      }).transform
    ).toBe('translateY(20px)');
  });
});

// apply() merges the mobile pass onto the breakpoint block and can never delete
// from it, so a callback that emits a property for some values of a key has to
// emit that property's neutral for the rest. Otherwise a desktop declaration
// survives inside the media query and a mobile override can move a field but
// never move it back. Each case below drives the override in BOTH directions.
describe('a mobile alignment override can return a field to the default', () => {
  const MOBILE_KEY = `@media (max-width: ${DEFAULT_MOBILE_BREAKPOINT}px)`;

  const mobileBlock = (
    type: string,
    target: string,
    styles: any,
    mobileStyles: any,
    properties: any = {}
  ) =>
    targets(type, styles, properties, mobileStyles).getTarget(target)[
      MOBILE_KEY
    ];

  it('re-centres text a desktop horizontal alignment moved', () => {
    const base = { ...untouched(), ...SIZED };

    // Moved on desktop, back to the start on mobile.
    expect(
      mobileBlock(
        'text_field',
        'field',
        { ...base, content_horizontal_align: 'center' },
        { content_horizontal_align: 'flex-start' }
      ).textAlign
    ).toBe('start');

    // And the other way, so the override is not simply being ignored.
    expect(
      mobileBlock('text_field', 'field', base, { content_horizontal_align: 'center' })
        .textAlign
    ).toBe('center');
  });

  it('un-spans a placeholder a desktop centre spanned', () => {
    const base = { ...untouched(), ...SIZED };
    const block = mobileBlock(
      'text_field',
      'placeholder',
      { ...base, content_horizontal_align: 'center' },
      { content_horizontal_align: 'flex-start' },
      { placeholder: 'Name' }
    );

    expect(block.textAlign).toBe('start');
    expect(block.insetInlineEnd).toBe('auto');
  });

  it('drops a synthesized vertical alignment back to centred', () => {
    const base = { ...untouched(), ...SIZED };

    // Desktop tops the text out with a 34.8px bottom padding; mobile has to
    // hand both sides back or the field stays top-aligned. With no padding
    // stored, what it hands back is resetStyles' own rem.
    const reset = mobileBlock(
      'text_field',
      'field',
      { ...base, content_vertical_align: 'flex-start' },
      { content_vertical_align: 'center' }
    );

    expect(reset.paddingTop).toBe('0.375rem');
    expect(reset.paddingBottom).toBe('0.375rem');

    // The desktop target still carries the synthesized value.
    expect(
      fieldTarget('text_field', { ...base, content_vertical_align: 'flex-start' })
        .paddingBottom
    ).toBe('34.8px');

    // Centred desktop, aligned mobile.
    const moved = mobileBlock('text_field', 'field', base, {
      content_vertical_align: 'flex-end'
    });

    expect(moved.paddingTop).toBe('34.8px');
    expect(moved.paddingBottom).toBe('0.375rem');
  });

  it('re-centres the placeholder with the text it stands in for', () => {
    const base = { ...untouched(), ...SIZED };

    expect(
      mobileBlock(
        'text_field',
        'placeholder',
        { ...base, content_vertical_align: 'flex-start' },
        { content_vertical_align: 'center' },
        { placeholder: 'Name' }
      ).top
    ).toBe('50%');
  });

  it('re-centres a dropdown chevron and a phone flag', () => {
    expect(
      mobileBlock(
        'dropdown',
        'field',
        { ...untouched(), ...SIZED, content_vertical_align: 'flex-start' },
        { content_vertical_align: 'center' }
      ).backgroundPositionY
    ).toBe('center');

    expect(
      mobileBlock(
        'phone_number',
        'fieldToggle',
        {
          ...untouched(),
          ...SIZED,
          content_vertical_align: 'flex-start'
        },
        { content_vertical_align: 'center' }
      ).transform
    ).toBe('none');
  });

  it('re-seats the inline icons a desktop alignment moved', () => {
    const base = {
      ...untouched(),
      ...SIZED,
      content_vertical_align: 'flex-start'
    };

    ['endIcon', 'tooltipTrigger'].forEach((target) => {
      expect([
        target,
        mobileBlock('ssn', target, base, { content_vertical_align: 'center' }).transform
      ]).toEqual([target, 'none']);
    });
  });

  it('keeps a restructured multiselect restructured across the breakpoint', () => {
    // A mobile override changes the padding, it does not un-ask for one: the
    // box still has a padding to inset from at both widths, so the column
    // stands. Getting back to react-select's own layout means clearing the key
    // in the builder, which leaves both viewports untouched -- there is no
    // mobile value that means "unset" while the desktop one is set, exactly as
    // for every other style key.
    const styles = targets(
      'dropdown_multi',
      { inner_padding_top: 20 },
      {},
      { inner_padding_top: 8 }
    );

    expect(styles.getTarget('fc')[MOBILE_KEY]).toEqual(
      expect.objectContaining({ display: 'flex', flexDirection: 'column' })
    );
    expect(styles.getTarget('sub-fc')[MOBILE_KEY].flexShrink).toBe(0);
    // The padding itself is what the override moves.
    expect(styles.getTarget('valueContainer')[MOBILE_KEY].paddingTop).toBe(
      '8px'
    );
  });

  it('lets a lowered padding shrink a box a raised one clamped', () => {
    const base = { ...untouched(), ...SIZED };

    // 40px of top padding needs a 65.2px box; a mobile override back down to
    // the 6px the field already rendered with has to release the clamp, or the
    // field stays taller on mobile forever.
    const released = mobileBlock(
      'text_field',
      'sub-fc',
      { ...base, inner_padding_top: 40 },
      { inner_padding_top: 6 }
    );

    expect(released.minHeight).toBe('auto');
    expect(
      boxTarget('text_field', { ...base, inner_padding_top: 40 }).minHeight
    ).toBe('65.2px');

    // A percentage-height box keeps applyHeight's own floor rather than 'auto'.
    const percent = { ...base, height: 100, height_unit: '%' };

    expect(
      mobileBlock(
        'text_field',
        'sub-fc',
        { ...percent, inner_padding_top: 40 },
        { inner_padding_top: 6 }
      ).minHeight
    ).toBe('50px');
  });

  it('re-centres multiselect chips a desktop alignment moved', () => {
    const block = mobileBlock(
      'dropdown_multi',
      'valueContainer',
      { ...untouched(), content_vertical_align: 'flex-end' },
      { content_vertical_align: 'center' }
    );

    expect(block.alignItems).toBe('center');
    expect(block.alignContent).toBe('center');
  });
});

describe('which fields count as carrying a pinned label', () => {
  // phone_number and payment_method render their placeholder chrome whatever
  // the theme stores, so a shrink_top phone has a pinned label -- and the
  // reserve behind it -- with no placeholder text at all. Gating the floor on
  // the text alone left "middle" dropping the reserve for exactly that config,
  // which is the bug this whole rule exists to stop.
  it('treats a phone with no placeholder text as having a pinned label', () => {
    const base = { ...SIZED, placeholder_transition: 'shrink_top' };
    const untouchedPhone = fieldTarget('phone_number', base);
    const centredPhone = fieldTarget('phone_number', {
      ...base,
      content_vertical_align: 'center'
    });
    expect(centredPhone.paddingTop).toBe(untouchedPhone.paddingTop);
    expect(centredPhone.paddingTop).toBe('21px');
  });

  // The reserve on a multiselect is not something an alignment can take over:
  // applyInputBoxAlignment places an input's value by padding this target, but
  // a multiselect's chips are laid out by flexbox on its value container. If
  // the reserve stands down for it, nothing holds the chips clear of the label.
  it('keeps a multiselect reserve when an alignment is set', () => {
    const styles = {
      ...SIZED,
      placeholder_transition: 'shrink_top'
    };
    const untouched = fieldTarget('dropdown_multi', styles, {
      placeholder: 'Pick'
    });
    const centred = fieldTarget(
      'dropdown_multi',
      { ...styles, content_vertical_align: 'center' },
      { placeholder: 'Pick' }
    );
    expect(untouched.paddingTop).toBe('21px');
    expect(centred.paddingTop).toBe(untouched.paddingTop);
  });

  // A multiselect places its chips with flexbox through applyMultiselectLayout,
  // which knows nothing of the reserve. Handing the floor to its chevron alone
  // would drop the glyph off the line its chips sit on.
  it('leaves a multiselect chevron on the line its chips sit on', () => {
    const centred = targets(
      MULTISELECT_FIELD,
      {
        ...SIZED,
        placeholder_transition: 'shrink_top',
        content_vertical_align: 'center'
      },
      { placeholder: 'Pick' }
    ).getTarget('field', true);
    expect(centred.backgroundPositionY).toBe('center');
  });
});

describe('the reserve a mobile typography override asks for', () => {
  const MOBILE_KEY = `@media (max-width: ${DEFAULT_MOBILE_BREAKPOINT}px)`;

  // Tall enough that the clamp never bites, so the footprint is what is being
  // measured rather than the room the box has left.
  const TALL_PINNED = {
    placeholder_transition: 'shrink_top',
    height: 200,
    height_unit: 'px',
    font_size: 16
  };

  const mobilePaddingTop = (styles: any, mobileStyles: any) =>
    targets(
      'text_field',
      styles,
      { placeholder: 'Name' },
      mobileStyles
    ).getTarget('field')[MOBILE_KEY]?.paddingTop;

  const desktopPaddingTop = (styles: any) =>
    fieldTarget('text_field', styles, { placeholder: 'Name' }).paddingTop;

  // The floor reads the values apply() resolved for the breakpoint it is
  // emitting, not the element's own styles. Reading the element meant a mobile
  // floor computed from the desktop typography: at a 28px mobile font the label
  // ends 33px down, the floor claimed 21, and "middle" pulled the value 12px up
  // into the label's ink -- the exact defect this floor exists to prevent,
  // surviving at the one breakpoint nothing measured.
  //
  // Both overrides have to change the reserve to be worth asserting on, so the
  // line-height case uses a box short enough for the clamp to bite: at 40px the
  // reserve is the room left over, and a 30px mobile line leaves 4px where the
  // desktop's 19.2px line leaves 15.
  it.each([
    ['font_size', TALL_PINNED, { font_size: 28 }],
    ['line_height', { ...TALL_PINNED, height: 40 }, { line_height: 30 }]
  ])(
    'leaves a centred field where a mobile %s override finds it',
    (_label, base, mobileStyles) => {
      const untouchedTop = mobilePaddingTop(base, mobileStyles);
      const centredTop = mobilePaddingTop(
        { ...base, content_vertical_align: 'center' },
        mobileStyles
      );

      // The invariant, not a number: 'middle' is a no-op on a field whose
      // padding nobody touched, at every breakpoint.
      expect(centredTop).toBe(untouchedTop);
      // ...and the breakpoint really is being exercised, rather than both sides
      // agreeing because neither emitted anything or because the override made
      // no difference to begin with.
      expect(untouchedTop).toBeDefined();
      expect(centredTop).not.toBe(
        desktopPaddingTop({ ...base, content_vertical_align: 'center' })
      );
    }
  );

  // The desktop half of the same override, so a fix that simply stopped
  // emitting a mobile block would fail rather than pass by omission.
  it('keeps the desktop reserve on the desktop font', () => {
    expect(
      targets(
        'text_field',
        { ...TALL_PINNED, content_vertical_align: 'center' },
        { placeholder: 'Name' },
        { font_size: 28 }
      ).getTarget('field', true).paddingTop
    ).toBe('21px');
  });
});

// The builder carries its own copy of this arithmetic and cannot import ours,
// so both repos pin the same table and a drift fails a test instead of
// shipping. The other half is 'the reserve both repos compute' in
// feathery-frontend's src/utils/__test__/boxSpacingHelper.spec.ts -- change one
// and you have to change the other.
describe('the reserve both repos compute', () => {
  it.each([
    // type, height, height_unit, font_size, line_height, reserve
    ['text_field', 200, 'px', 16, undefined, 21], // the plain footprint
    ['text_field', 40, 'px', 16, undefined, 15], // clamped: 40 - 19.2 - 6
    ['text_field', 40, 'px', 16, 30, 4], // clamped against a stored line
    ['text_field', 200, 'px', 9, undefined, 14], // sub-10px font: 4.5 + 9
    ['text_field', 90, '%', 16, undefined, 21], // no pixel box to clamp against
    ['text_area', 200, 'px', 16, undefined, 25], // its own 2.5x reserve
    ['text_area', 200, 'px', 9, undefined, 23] // 9 * 2.5, rounded
  ])(
    '%s at %s%s, font %s, line height %s reserves %spx',
    (type, height, heightUnit, fontSize, lineHeight, expected) => {
      const styles: any = {
        placeholder_transition: 'shrink_top',
        height,
        height_unit: heightUnit,
        font_size: fontSize
      };
      if (lineHeight !== undefined) styles.line_height = lineHeight;
      expect(
        fieldTarget(type as string, styles, { placeholder: 'Name' }).paddingTop
      ).toBe(`${expected}px`);
    }
  );
});

import ResponsiveStyles, {
  DEFAULT_MOBILE_BREAKPOINT,
  INPUT_BOX_FIELDS
} from '../../styles';
import { applyFieldStyles } from '../index';

// An input box is a sibling of its field's label inside 'fc', and 'fc' is
// already the cell's full height. A percentage height that resolves to the
// whole cell therefore leaves no room for the label, and the box hangs out the
// bottom of its own cell over whatever element follows -- which is the bug
// these tests pin. jsdom has no layout engine, so they assert the declarations
// that produce the geometry rather than the geometry itself.
const BASE_STYLES = { background_color: 'FFFFFFFF', flex_direction: 'row' };

// Deliberately shaped like innerPadding.spec.ts's helper of the same name, but
// these cases need mobile styles rather than properties -- so the parameter is
// named for what it is, and properties are not accepted at all.
function targets(
  type: string,
  styles: any = {},
  { mobileStyles = {} }: { mobileStyles?: any } = {}
) {
  const element = {
    servar: { type, metadata: {} },
    properties: {},
    styles: { ...BASE_STYLES, ...styles },
    mobile_styles: mobileStyles
  };
  const responsiveStyles = new ResponsiveStyles(element, [], true);
  applyFieldStyles(element, responsiveStyles);
  return responsiveStyles;
}

const PCT = { height: 100, height_unit: '%' };
const PX = { height: 50, height_unit: 'px' };
const FIT = { height: '', height_unit: 'fit' };

describe('a percentage-height input box', () => {
  it('grows into the room its label leaves rather than taking the cell', () => {
    const t = targets('text_field', PCT);
    // 'fc' distributes its own height...
    expect(t.getTarget('fc', true)).toEqual(
      expect.objectContaining({ display: 'flex', flexDirection: 'column' })
    );
    // ...and the box shrinks out of the label's way, from a basis of
    // applyHeight's own `height: 100%` rather than from zero. Not a basis of 0:
    // this rule is keyed on the unit and cannot know whether the percentage
    // resolved, and under a Fit container it does not -- a basis of 0 there
    // made the box contribute nothing to its own cell, collapsing a 6-row text
    // area from 123px to the floor. applyHeight's floor still catches a box
    // with nothing left to take.
    const box = t.getTarget('sub-fc', true);
    expect(box.flex).toBe('1 1 auto');
    expect(box.minHeight).toBe('50px');
  });

  it('holds for every input-box type', () => {
    INPUT_BOX_FIELDS.forEach((type) => {
      const box = targets(type, PCT).getTarget('sub-fc', true);
      expect([type, box.flex]).toEqual([type, '1 1 auto']);
    });
  });
});

describe('what a percentage height must not disturb', () => {
  it.each([
    ['pixel', PX],
    ['fit', FIT]
  ])('emits the neutral, never the flex path, for a %s height', (_l, styles) => {
    const t = targets('text_field', styles);
    expect(t.getTarget('sub-fc', true).flex).toBe('0 1 auto');
    expect(t.getTarget('fc', true)).toEqual(
      expect.objectContaining({ display: 'block', flexDirection: 'row' })
    );
  });

  it('emits nothing at all when no height unit is stored', () => {
    const t = targets('text_field', {});
    expect(t.getTarget('sub-fc', true)).not.toHaveProperty('flex');
    expect(t.getTarget('fc', true)).not.toHaveProperty('display');
  });

  // The rule is about a label stacked above a box. Other field types spend
  // 'fc' differently -- a checkbox lays it out as an inline row -- so a column
  // there would restack them.
  it.each(['checkbox', 'select', 'multiselect', 'button_group', 'file_upload'])(
    'leaves %s alone',
    (type) => {
      const t = targets(type, PCT);
      expect(t.getTarget('fc', true)).not.toHaveProperty('display');
      expect(t.getTarget('sub-fc', true)).not.toHaveProperty('flex');
    }
  );
});

describe('across the mobile breakpoint', () => {
  // apply() can only merge, so a callback that emits for one unit has to emit
  // the neutral for the rest or a mobile override can never undo it. Without
  // this, a desktop percentage left flex-basis 0 standing at mobile and the
  // box ignored the pixel height it was overridden to.
  it('lets a mobile pixel override take the box off the flex path', () => {
    const t = targets('text_field', PCT, { mobileStyles: PX });
    const key = `@media (max-width: ${DEFAULT_MOBILE_BREAKPOINT}px)`;
    expect((t.getTarget('sub-fc') as any)[key].flex).toBe('0 1 auto');
    expect((t.getTarget('fc') as any)[key]).toEqual(
      expect.objectContaining({ display: 'block', flexDirection: 'row' })
    );
  });

  it('lets a mobile percentage override put it back on', () => {
    const t = targets('text_field', PX, { mobileStyles: PCT });
    const key = `@media (max-width: ${DEFAULT_MOBILE_BREAKPOINT}px)`;
    expect((t.getTarget('sub-fc') as any)[key].flex).toBe('1 1 auto');
    expect((t.getTarget('fc') as any)[key].flexDirection).toBe('column');
  });
});

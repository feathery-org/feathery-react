import { formatContainerStyles } from './transform';

const sidebar = {
  width: '184px',
  height: 'fit',
  styles: {},
  mobile_styles: { width_unit: 'fill', height: 72, height_unit: 'px', gap: 8 }
};

describe('native mobile container sizing', () => {
  it('honors persisted mobile style dimensions when native overrides are absent', () => {
    expect(formatContainerStyles(sidebar)).toMatchObject({
      styles: { width: 184, width_unit: 'px', height: 'fit' },
      mobile_styles: {
        width: 'fill',
        width_unit: 'fill',
        height: 72,
        height_unit: 'px',
        gap: 8
      }
    });
  });

  it('keeps explicit native dimensions authoritative', () => {
    expect(
      formatContainerStyles({
        ...sidebar,
        mobile_width: '280px',
        mobile_height: 'fit'
      }).mobile_styles
    ).toMatchObject({
      width: 280,
      width_unit: 'px',
      height: 'fit'
    });
  });

  it('inherits desktop dimensions without an explicit mobile setting', () => {
    expect(
      formatContainerStyles({ ...sidebar, mobile_styles: {} }).mobile_styles
    ).toMatchObject({
      width: 184,
      width_unit: 'px',
      height: 'fit'
    });
  });

  it('preserves independent field style dimensions', () => {
    expect(
      formatContainerStyles({
        ...sidebar,
        isElement: true,
        mobile_styles: { width: 100, width_unit: '%' }
      }).mobile_styles
    ).toMatchObject({
      width: 100,
      width_unit: '%'
    });
  });
});

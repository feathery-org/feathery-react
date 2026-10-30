import ResponsiveStyles from '../../../../styles';
import { createCheckboxElement } from '../../tests/test-utils';
import { applyToggleStyles } from './styles';

const toggleStyles = (styles: any, mobileStyles?: any) => {
  const element = {
    ...createCheckboxElement('checkbox', {}, styles),
    ...(mobileStyles ? { mobile_styles: mobileStyles } : {})
  };
  return applyToggleStyles(new ResponsiveStyles(element, [], !!mobileStyles));
};

describe('applyToggleStyles', () => {
  it('uses the checkbox size as the toggle height', () => {
    const styles = toggleStyles({ height: 20, height_unit: 'px' });

    expect(styles.getTarget('toggle')).toMatchObject({
      height: '20px',
      width: '36px'
    });
    expect(styles.getTarget('toggleTrack').height).toBe('20px');
    expect(styles.getTarget('toggleKnob')).toMatchObject({
      top: '1px',
      left: '1px',
      height: '18px',
      width: '18px'
    });
    expect(styles.getTarget('toggleKnobChecked').transform).toBe(
      'translateX(16px)'
    );
  });

  it('keeps an inset knob inside the track border', () => {
    const styles = toggleStyles({
      height: 20,
      height_unit: 'px',
      border_top_width: 2
    });

    expect(styles.getTarget('toggleKnob')).toMatchObject({
      top: '3px',
      height: '14px'
    });
    expect(styles.getTarget('toggleKnobChecked').transform).toBe(
      'translateX(16px)'
    );
  });

  it('lets the knob overhang a shorter track', () => {
    const styles = toggleStyles({
      height: 24,
      height_unit: 'px',
      track_height: 12,
      border_top_width: 2
    });

    expect(styles.getTarget('toggle')).toMatchObject({
      height: '24px',
      width: '43px'
    });
    expect(styles.getTarget('toggleTrack').height).toBe('12px');
    expect(styles.getTarget('toggleKnob')).toMatchObject({
      top: '0px',
      left: '0px',
      height: '24px',
      width: '24px'
    });
    expect(styles.getTarget('toggleKnobChecked').transform).toBe(
      'translateX(19px)'
    );
  });

  it('caps the track at the toggle height', () => {
    const styles = toggleStyles({
      height: 20,
      height_unit: 'px',
      track_height: 30
    });

    expect(styles.getTarget('toggleTrack').height).toBe('20px');
    expect(styles.getTarget('toggleKnob').height).toBe('18px');
  });

  it('scales the toggle and knob with a mobile size override', () => {
    const styles = toggleStyles(
      { height: 20, height_unit: 'px' },
      { height: 30, height_unit: 'px', track_height: 10 }
    );
    const mobileKey = `@media (max-width: ${styles.getMobileBreakpoint()}px)`;

    expect(styles.getTarget('toggle')[mobileKey]).toMatchObject({
      height: '30px',
      width: '54px'
    });
    expect(styles.getTarget('toggleTrack')[mobileKey].height).toBe('10px');
    expect(styles.getTarget('toggleKnobChecked')[mobileKey].transform).toBe(
      'translateX(24px)'
    );
  });

  it('uses the selected background as the on colour, falling back to the checkmark colour', () => {
    expect(
      toggleStyles({
        selected_background_color: '112233',
        selected_font_color: 'aabbcc'
      }).getTarget('toggleOn').backgroundColor
    ).toBe('#112233');
    expect(
      toggleStyles({ selected_font_color: 'aabbcc' }).getTarget('toggleOn')
        .backgroundColor
    ).toBe('#aabbcc');
  });

  it('maps background and hover colours onto the segments', () => {
    const styles = toggleStyles({
      background_color: 'eeeeee',
      hover_background_color: 'dddddd',
      hover_font_color: '445566'
    });

    expect(styles.getTarget('toggleOff').backgroundColor).toBe('#eeeeee');
    expect(styles.getTarget('toggleOffHover').backgroundColor).toBe('#dddddd');
    expect(styles.getTarget('toggleOnHover').backgroundColor).toBe('#445566');
  });

  it('colours the knob, staying white when unset', () => {
    expect(
      toggleStyles({ knob_color: '112233FF' }).getTarget('toggleKnob')
        .backgroundColor
    ).toBe('#112233FF');
    expect(
      toggleStyles({}).getTarget('toggleKnob').backgroundColor
    ).toBeUndefined();
  });

  it('applies default, hover and selected borders to the track', () => {
    const border = (prefix: string, colour: string) =>
      Object.fromEntries(
        ['top', 'right', 'bottom', 'left'].flatMap((side) => [
          [`${prefix}border_${side}_color`, colour],
          [`${prefix}border_${side}_pattern`, 'solid'],
          [`${prefix}border_${side}_width`, 1]
        ])
      );
    const styles = toggleStyles({
      ...border('', '111111'),
      ...border('hover_', '222222'),
      ...border('selected_', '333333')
    });

    expect(styles.getTarget('toggleTrack').borderTopColor).toBe('#111111');
    expect(styles.getTarget('toggleTrackHover').borderTopColor).toBe(
      '#222222 !important'
    );
    expect(styles.getTarget('toggleTrackChecked').borderTopColor).toBe(
      '#333333 !important'
    );
  });

  it('applies corners to the track and insets them on the knob', () => {
    const styles = toggleStyles({
      height: 30,
      height_unit: 'px',
      corner_top_left_radius: 6,
      corner_top_right_radius: 6,
      corner_bottom_right_radius: 1,
      corner_bottom_left_radius: 0
    });

    expect(styles.getTarget('toggleTrack').borderRadius).toBe(
      '6px 6px 1px 0px'
    );
    // 30px tracks have 2px of padding around the knob
    expect(styles.getTarget('toggleKnob').borderRadius).toBe('4px 4px 0px 0px');
  });

  it('keeps the pill shape when corners are unset', () => {
    const styles = toggleStyles({});

    expect(styles.getTarget('toggleTrack').borderRadius).toBeUndefined();
    expect(styles.getTarget('toggleKnob').borderRadius).toBeUndefined();
  });

  it('uses label_gap for the label spacing', () => {
    expect(
      toggleStyles({ label_gap: 12 }).getTarget('toggle').marginRight
    ).toBe('12px');
    expect(toggleStyles({}).getTarget('toggle').marginRight).toBe('8px');
  });
});

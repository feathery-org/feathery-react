import React, { useMemo } from 'react';
import {
  hoverStylesGuard,
  iosScrollOnFocus
} from '../../../../../utils/browser';
import {
  applyToggleStyles,
  toggleBaseStyles,
  toggleTrackBaseStyles,
  toggleSegmentBaseStyles,
  toggleKnobBaseStyles,
  toggleKnobCheckedBaseStyles,
  toggleInputStyles
} from './styles';

export default function Toggle({
  id,
  name,
  checked,
  onChange,
  ariaLabel,
  responsiveStyles,
  disabled = false
}: {
  id: string;
  name: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
  responsiveStyles: any;
  disabled?: boolean;
}) {
  const styles = useMemo(
    () => applyToggleStyles(responsiveStyles),
    [responsiveStyles]
  );

  // getTargets merges each target's mobile overrides rather than letting the
  // last spread target's media query replace the others
  const trackStyles = styles.getTargets(
    'toggleTrack',
    checked ? 'toggleTrackChecked' : ''
  );
  // Re-apply the checked borders on hover so the selected state still wins,
  // matching the checkbox's :checked-after-:hover ordering
  const trackHoverStyles = styles.getTargets(
    'toggleTrackHover',
    checked ? 'toggleTrackChecked' : ''
  );
  // A disabled background colour replaces both segment colours; otherwise the
  // disabled target dims the whole toggle, knob included
  const disabledStyles = disabled ? styles.getTargets('disabled') : {};
  const disabledBackground = disabled
    ? styles.getTarget('disabled', true).backgroundColor
    : undefined;
  const segmentStyles = (isOn: boolean) => ({
    ...toggleSegmentBaseStyles(isOn, isOn === checked),
    ...styles.getTargets(isOn ? 'toggleOn' : 'toggleOff'),
    ...(disabledBackground ? { backgroundColor: disabledBackground } : {})
  });

  return (
    <div
      css={{
        ...toggleBaseStyles(),
        ...styles.getTargets('toggle'),
        ...(disabled && !disabledBackground ? disabledStyles : {}),
        ...(disabled ? { cursor: 'default' } : {}),
        '&:has(input:focus-visible)': {
          outline: '2px solid rgb(74, 144, 226)',
          outlineOffset: 2
        },
        '&:hover': hoverStylesGuard(
          disabled
            ? {}
            : {
                '& [data-toggle-track]': trackHoverStyles,
                '& [data-toggle-segment="on"]':
                  styles.getTargets('toggleOnHover'),
                '& [data-toggle-segment="off"]':
                  styles.getTargets('toggleOffHover')
              }
        )
      }}
    >
      {/* The knob sits beside the track rather than in it, so it can overhang
          a track shorter than the toggle */}
      <div
        data-toggle-track
        css={{ ...toggleTrackBaseStyles(), ...trackStyles }}
      >
        <div data-toggle-segment='on' css={segmentStyles(true)} />
        <div data-toggle-segment='off' css={segmentStyles(false)} />
      </div>
      <div
        css={{
          ...toggleKnobBaseStyles(),
          ...styles.getTargets('toggleKnob'),
          ...(checked
            ? {
                ...toggleKnobCheckedBaseStyles(),
                ...styles.getTargets('toggleKnobChecked')
              }
            : {})
        }}
      />
      {/* The real checkbox, invisible and stretched over the toggle, so it is
          driven, submitted and announced exactly like the checkbox */}
      <input
        id={id}
        name={name}
        type='checkbox'
        role='switch'
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        onFocus={iosScrollOnFocus}
        aria-label={ariaLabel}
        css={toggleInputStyles()}
      />
    </div>
  );
}

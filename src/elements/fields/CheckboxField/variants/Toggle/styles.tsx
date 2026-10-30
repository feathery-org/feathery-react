import { CSSObject } from '@emotion/react';
import { isNum } from '../../../../../utils/primitives';

// Used until the element's own height style resolves
const DEFAULT_HEIGHT = 20;
const DEFAULT_LABEL_GAP = 8;
const DEFAULT_OFF_COLOUR = '#ccc';
const DEFAULT_ON_COLOUR = '#4caf50';

const TRANSITION = '0.2s ease-in-out';

// The knob fills the toggle's height. When the track is shorter it overhangs
// the track, otherwise it sits inside the track's padding and border.
const getToggleDimensions = (
  height: number,
  trackHeight = height,
  border = 0
) => {
  const overhang = trackHeight < height;
  const inset = overhang ? 0 : Math.round(height / 15) + border;
  const width = Math.round(height * 1.8);
  return {
    height,
    width,
    trackHeight: overhang ? trackHeight : height,
    inset,
    knobSize: height - inset * 2,
    // Same in both modes: the knob's inset is on both sides
    knobTravel: width - height
  };
};

type ToggleDimensions = ReturnType<typeof getToggleDimensions>;

const formatColour = (colour: string) =>
  colour === 'transparent' ? colour : `#${colour}`;

const toggleSize = ({ height, width }: ToggleDimensions): CSSObject => ({
  height: `${height}px`,
  width: `${width}px`
});

const trackSize = ({ trackHeight }: ToggleDimensions): CSSObject => ({
  height: `${trackHeight}px`
});

const knobSize = ({ inset, knobSize }: ToggleDimensions): CSSObject => ({
  top: `${inset}px`,
  left: `${inset}px`,
  height: `${knobSize}px`,
  width: `${knobSize}px`
});

const CORNERS = [
  'corner_top_left_radius',
  'corner_top_right_radius',
  'corner_bottom_right_radius',
  'corner_bottom_left_radius'
];

// An inset knob's corners shrink by its inset so its curve follows the
// track's. Unset corners keep the base pill shape.
const cornerRadius = (corners: any[], inset = 0): CSSObject =>
  corners.every((corner) => !isNum(corner))
    ? {}
    : {
        borderRadius: corners
          .map((corner) => `${Math.max(Number(corner ?? 0) - inset, 0)}px`)
          .join(' ')
      };

const knobCheckedOffset = ({ knobTravel }: ToggleDimensions): CSSObject => ({
  transform: `translateX(${knobTravel}px)`
});

const SIZE_PROPS = [
  'height',
  'height_unit',
  'track_height',
  'border_top_width'
];

const sizedDimensions = (
  height: any,
  unit: any,
  trackHeight: any,
  border: any
): ToggleDimensions | null => {
  if (!isNum(height) || (unit && unit !== 'px')) return null;
  return getToggleDimensions(
    Number(height),
    isNum(trackHeight) ? Number(trackHeight) : Number(height),
    isNum(border) ? Number(border) : 0
  );
};

const DEFAULT_DIMENSIONS = getToggleDimensions(DEFAULT_HEIGHT);

// Maps the checkbox style settings onto the toggle's parts. The checkbox's
// square size becomes the toggle's height. The checkmark colour is the "on"
// fallback so themed toggles keep the theme's brand colour.
export function applyToggleStyles(responsiveStyles: any) {
  responsiveStyles.addTargets(
    'toggle',
    'toggleTrack',
    'toggleTrackHover',
    'toggleTrackChecked',
    'toggleOn',
    'toggleOnHover',
    'toggleOff',
    'toggleOffHover',
    'toggleKnob',
    'toggleKnobChecked'
  );

  const applySized = (
    target: string,
    get: (dimensions: ToggleDimensions) => CSSObject
  ) =>
    responsiveStyles.apply(target, SIZE_PROPS, (...values: any[]) => {
      const dimensions = sizedDimensions(...(values as [any, any, any, any]));
      return dimensions ? get(dimensions) : {};
    });

  applySized('toggle', toggleSize);
  applySized('toggleTrack', trackSize);
  applySized('toggleKnob', knobSize);
  applySized('toggleKnobChecked', knobCheckedOffset);

  responsiveStyles.apply('toggleTrack', CORNERS, (...corners: any[]) =>
    cornerRadius(corners)
  );
  responsiveStyles.apply(
    'toggleKnob',
    [...CORNERS, ...SIZE_PROPS],
    (...values: any[]) => {
      const dimensions =
        sizedDimensions(
          ...(values.slice(CORNERS.length) as [any, any, any, any])
        ) ?? DEFAULT_DIMENSIONS;
      return cornerRadius(values.slice(0, CORNERS.length), dimensions.inset);
    }
  );

  responsiveStyles.apply('toggle', 'label_gap', (gap: any) => ({
    marginRight: `${gap ?? DEFAULT_LABEL_GAP}px`
  }));
  responsiveStyles.applyBorders({ target: 'toggleTrack' });
  responsiveStyles.applyBoxShadow('toggleTrack');
  responsiveStyles.applyBorders({
    target: 'toggleTrackHover',
    prefix: 'hover_'
  });
  responsiveStyles.applyBorders({
    target: 'toggleTrackChecked',
    prefix: 'selected_'
  });

  responsiveStyles.applyColor(
    'toggleOff',
    'background_color',
    'backgroundColor'
  );
  responsiveStyles.applyColor(
    'toggleOffHover',
    'hover_background_color',
    'backgroundColor'
  );
  responsiveStyles.apply(
    'toggleOn',
    ['selected_background_color', 'selected_font_color'],
    (background: any, checkmark: any) => {
      const colour = background || checkmark;
      return colour ? { backgroundColor: formatColour(colour) } : {};
    }
  );
  responsiveStyles.applyColor(
    'toggleOnHover',
    'hover_font_color',
    'backgroundColor'
  );
  responsiveStyles.applyColor('toggleKnob', 'knob_color', 'backgroundColor');

  return responsiveStyles;
}

export const toggleBaseStyles = (): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  position: 'relative',
  marginLeft: 5,
  cursor: 'pointer',
  ...toggleSize(DEFAULT_DIMENSIONS)
});

export const toggleTrackBaseStyles = (): CSSObject => ({
  // No padding here: the colour segments fill the whole rounded track
  display: 'flex',
  flexDirection: 'row',
  boxSizing: 'border-box',
  overflow: 'hidden',
  borderRadius: '9999px',
  width: '100%',
  transition: `border-color ${TRANSITION}`,
  ...trackSize(DEFAULT_DIMENSIONS)
});

export const toggleSegmentBaseStyles = (
  isOn: boolean,
  active: boolean
): CSSObject => ({
  height: '100%',
  width: active ? '100%' : '0%',
  backgroundColor: isOn ? DEFAULT_ON_COLOUR : DEFAULT_OFF_COLOUR,
  transition: `background-color ${TRANSITION}, width ${TRANSITION}`
});

export const toggleKnobBaseStyles = (): CSSObject => ({
  position: 'absolute',
  borderRadius: '9999px',
  backgroundColor: '#fff',
  // Keeps the knob visible on light "off" tracks
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
  transform: 'translateX(0px)',
  transition: `transform ${TRANSITION}`,
  ...knobSize(DEFAULT_DIMENSIONS)
});

export const toggleKnobCheckedBaseStyles = (): CSSObject =>
  knobCheckedOffset(DEFAULT_DIMENSIONS);

// Invisible but still clickable, focusable and announced
export const toggleInputStyles = (): CSSObject => ({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  opacity: 0,
  cursor: 'inherit',
  zIndex: 1
});

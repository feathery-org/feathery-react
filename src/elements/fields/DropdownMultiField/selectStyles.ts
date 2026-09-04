import type { StylesConfig } from 'react-select';

import { MULTISELECT_CHEVRON_RESERVE } from '../../styles';
import type ResponsiveStyles from '../../styles';

import type { DropdownSelectProps, OptionData } from './types';

type SelectStylesParams = {
  // Only a themed alignment distributes free space across the line. Left as
  // it comes, the chips pack from the start and a trailing caret changes
  // nothing. Passed in resolved for the current viewport, since these styles
  // are applied in JS where a media query cannot pick the value.
  aligned: boolean;
  fontColor: string;
  menuZIndex: number;
  responsiveStyles: ResponsiveStyles;
  rightToLeft: boolean | undefined;
};

export function createSelectStyles({
  aligned,
  fontColor,
  menuZIndex,
  responsiveStyles,
  rightToLeft
}: SelectStylesParams): StylesConfig<OptionData, boolean> {
  const styles = {
    control: (baseStyles) => ({
      ...baseStyles,
      width: '100%',
      height: '100%',
      minHeight: 'inherit',
      border: 'none',
      boxShadow: 'none',
      backgroundColor: 'transparent',
      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${fontColor}'/></svg>")`,
      backgroundRepeat: 'no-repeat',
      // Split from the shorthand, and the target spread last, so the themed
      // vertical placement survives -- the chevron rides the chips' line. The
      // inline offset is the custom property the theme emits, so a mobile
      // padding override moves the glyph with the chips.
      backgroundPositionX: `${
        rightToLeft ? 'left' : 'right'
      } var(--fe-chevron-x, 10px)`,
      backgroundPositionY: 'center',
      position: 'relative',
      ...responsiveStyles.getTarget('field')
    }),
    container: (baseStyles) => ({
      ...baseStyles,
      height: '100%',
      minHeight: 'inherit'
    }),
    valueContainer: (baseStyles, state) => {
      const selectProps = state.selectProps as DropdownSelectProps & {
        inputValue?: string;
      };
      if (!selectProps.isMulti) {
        // Constant layout: nothing here reacts to menu-open or typing, so the
        // value text can't shift. react-select grids this, so flex is inert.
        return {
          ...baseStyles,
          paddingInlineEnd: 28,
          minWidth: 0,
          alignItems: 'center'
        };
      }

      const shouldWrap =
        !selectProps.collapseSelected || !!selectProps.inputValue;
      const paddingBlock = shouldWrap
        ? {
            paddingTop:
              baseStyles.paddingTop !== undefined
                ? baseStyles.paddingTop
                : '8px',
            paddingBottom:
              baseStyles.paddingBottom !== undefined
                ? baseStyles.paddingBottom
                : '8px'
          }
        : {};

      return {
        ...baseStyles,
        ...paddingBlock,
        paddingInlineEnd: MULTISELECT_CHEVRON_RESERVE,
        display: 'flex',
        minWidth: 0,
        flexWrap: shouldWrap ? 'wrap' : 'nowrap',
        alignItems: shouldWrap ? 'flex-start' : 'center',
        alignContent: shouldWrap ? 'flex-start' : 'center',
        // Themed inner padding and content alignment win over the defaults
        // above; absent from the theme, this contributes nothing.
        ...responsiveStyles.getTarget('valueContainer'),
        ...(selectProps.collapseSelected
          ? {
              '& .rs-collapsed-chip': {
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 8px',
                margin: '2px',
                borderRadius: baseStyles.borderRadius ?? 2,
                backgroundColor:
                  baseStyles.backgroundColor ?? 'rgba(221, 221, 221, 0.8)',
                color: baseStyles.color ?? '#333',
                fontSize: baseStyles.fontSize ?? '0.85em'
              }
            }
          : {})
      };
    },
    // Inherit the control's theme font styles, as the native DropdownField does
    singleValue: (baseStyles) => ({
      ...baseStyles,
      color: 'inherit',
      fontSize: 'inherit',
      marginLeft: 0,
      marginRight: 0
    }),
    multiValueLabel: (baseStyles, state) => {
      const selectProps = state.selectProps as DropdownSelectProps;
      if (selectProps.collapseSelected) {
        return {
          ...baseStyles,
          whiteSpace: 'normal',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
          wordBreak: 'break-word',
          maxWidth: '100%'
        };
      }

      return {
        ...baseStyles,
        whiteSpace: 'normal',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 3
      };
    },
    indicatorSeparator: () => ({ display: 'none' }),
    indicatorsContainer: () => ({ display: 'none' }),
    menu: (baseStyles) => ({
      ...baseStyles,
      zIndex: menuZIndex,
      textAlign: 'start'
    }),
    menuList: (baseStyles) => ({
      ...baseStyles,
      // Grid makes all options same width (widest wins), enabling full-row highlights
      display: 'grid',
      overflowX: 'auto',
      overflowY: 'auto'
    }),
    option: (baseStyles) => ({
      ...baseStyles,
      whiteSpace: 'nowrap'
    }),
    multiValue: (baseStyles, state) => {
      const selectProps = state.selectProps as DropdownSelectProps;
      if (!selectProps.collapseSelected) return baseStyles;

      return {
        ...baseStyles,
        maxWidth: '100%',
        // A chip holds its natural width rather than being squeezed narrower
        // than its label. Squeezed, the label wrapped to two or three lines and
        // the row of chips read as unreadable stacks -- and inner padding, which
        // takes its width out of the same space, made that the common case.
        // The count indicator absorbs the ones that no longer fit instead.
        flexShrink: 0,
        overflow: 'hidden',
        marginInline: '2px',
        borderRadius: baseStyles.borderRadius ?? 2
      };
    },
    input: (baseStyles, state) => {
      const selectProps = state.selectProps as DropdownSelectProps & {
        inputHidden?: boolean;
        inputValue?: string;
      };

      if (!selectProps.collapseSelected || !selectProps.inputHidden) {
        // The caret is a flex item on the last line, so a themed alignment
        // centres the chips *and* it -- invisible while empty, but wide enough
        // to push them off centre, and wider still once react-select lets it
        // fill the line. Keep an empty one out of the arithmetic; typing gives
        // it its width back, where it is earning the space.
        if (aligned && !selectProps.inputValue)
          return {
            ...baseStyles,
            flexGrow: 0,
            flexBasis: 'auto',
            // A 1px sliver rather than zero width, so the caret stays
            // visible while focused -- and the descendant rule to actually
            // constrain the inner input, whose width react-select sets
            // inline.
            maxWidth: '1px',
            width: '1px',
            minWidth: '1px',
            overflow: 'hidden',
            margin: 0,
            padding: 0,
            '> input': {
              width: '1px',
              minWidth: '1px'
            }
          };
        return baseStyles;
      }

      return {
        ...baseStyles,
        opacity: 0,
        maxWidth: '1px',
        width: '1px',
        minWidth: '1px',
        flexBasis: 0,
        flexGrow: 0,
        flexShrink: 0,
        margin: 0,
        padding: 0,
        pointerEvents: 'none',
        position: 'absolute',
        top: 0,
        right: 0,
        overflow: 'hidden',
        '> input': {
          width: '1px',
          minWidth: '1px',
          opacity: 0,
          pointerEvents: 'none'
        }
      };
    }
  } as StylesConfig<OptionData, boolean>;

  return styles;
}

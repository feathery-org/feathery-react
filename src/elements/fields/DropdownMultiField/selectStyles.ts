import type { StylesConfig } from 'react-select';

import type ResponsiveStyles from '../../styles';

import type { DropdownSelectProps, OptionData } from './types';

type SelectStylesParams = {
  chevronPosition: number;
  fontColor: string;
  menuZIndex: number;
  responsiveStyles: ResponsiveStyles;
  rightToLeft: boolean | undefined;
};

export function createSelectStyles({
  chevronPosition,
  fontColor,
  menuZIndex,
  responsiveStyles,
  rightToLeft
}: SelectStylesParams): StylesConfig<OptionData, true> {
  const styles = {
    control: (baseStyles) => ({
      ...baseStyles,
      ...responsiveStyles.getTarget('field'),
      width: '100%',
      height: '100%',
      minHeight: 'inherit',
      border: 'none',
      boxShadow: 'none',
      backgroundColor: 'transparent',
      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${fontColor}'/></svg>")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: `${
        rightToLeft ? 'left' : 'right'
      } ${chevronPosition}px center`,
      position: 'relative'
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
        paddingInlineEnd: 28,
        display: 'flex',
        minWidth: 0,
        flexWrap: shouldWrap ? 'wrap' : 'nowrap',
        alignItems: shouldWrap ? 'flex-start' : 'center',
        alignContent: shouldWrap ? 'flex-start' : 'center',
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
    multiValue: (baseStyles, state) => {
      const selectProps = state.selectProps as DropdownSelectProps;
      if (!selectProps.collapseSelected) return baseStyles;

      return {
        ...baseStyles,
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
        marginInline: '2px',
        borderRadius: baseStyles.borderRadius ?? 2
      };
    },
    input: (baseStyles, state) => {
      const selectProps = state.selectProps as DropdownSelectProps & {
        inputHidden?: boolean;
      };

      if (!selectProps.collapseSelected || !selectProps.inputHidden) {
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
  } as StylesConfig<OptionData, true>;

  return styles;
}

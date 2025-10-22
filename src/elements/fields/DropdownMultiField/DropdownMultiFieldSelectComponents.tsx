import React, { ComponentType, useRef, useState } from 'react';
import {
  components as SelectComponents,
  type MultiValueGenericProps,
  type MultiValueProps,
  type OptionProps,
  type MultiValueRemoveProps
} from 'react-select';

import Overlay from '../../components/Overlay';
import { Tooltip } from '../../components/Tooltip';
import { FORM_Z_INDEX } from '../../../utils/styles';

import type { DropdownSelectProps, OptionData } from './types';

const TooltipOption = ({
  children,
  ...props
}: OptionProps<OptionData, true>) => {
  const optionRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const containerRef = (props.selectProps as any).containerRef as
    | React.RefObject<HTMLElement | null>
    | undefined;

  return (
    <div
      ref={optionRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* @ts-ignore react-select typings omit custom props */}
      <SelectComponents.Option {...props}>{children}</SelectComponents.Option>
      {props.data.tooltip && optionRef.current && (
        <Overlay
          targetRef={optionRef}
          containerRef={containerRef}
          show={showTooltip}
          placement='right'
        >
          <Tooltip
            id={`tooltip-${props.data.value}`}
            css={{
              zIndex: FORM_Z_INDEX + 1,
              padding: '.4rem 0',
              transition: 'opacity .10s linear',
              '.tooltip-inner': {
                maxWidth: '200px',
                padding: '.25rem .5rem',
                color: '#fff',
                textAlign: 'center',
                backgroundColor: '#000',
                borderRadius: '.25rem',
                fontSize: 'smaller'
              }
            }}
          >
            {props.data.tooltip}
          </Tooltip>
        </Overlay>
      )}
    </div>
  );
};

const BaseMultiValueRemove = SelectComponents.MultiValueRemove as ComponentType<
  MultiValueRemoveProps<OptionData>
>;

// Prevent react-select from interpreting remove taps as control clicks. Without
// this guard the menu closes immediately when a collapsed chip is dismissed on
// touch devices
const CollapsibleMultiValueRemove = (
  props: MultiValueRemoveProps<OptionData>
) => {
  const removeInnerProps = {
    ...props.innerProps,
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.innerProps?.onMouseDown?.(event);
    },
    onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.innerProps?.onTouchStart?.(event);
    },
    'data-feathery-multi-value-remove': 'true'
  };

  return <BaseMultiValueRemove {...props} innerProps={removeInnerProps} />;
};

const CollapsedIndicator = ({ collapsedCount }: { collapsedCount: number }) =>
  collapsedCount > 0 ? (
    <span className='rs-collapsed-chip'>+{collapsedCount}</span>
  ) : null;

const CollapsibleMultiValueContainer = (
  props: MultiValueGenericProps<OptionData, true>
) => {
  const selectProps = props.selectProps as DropdownSelectProps;

  const BaseContainer = SelectComponents.MultiValueContainer as ComponentType<
    MultiValueGenericProps<OptionData, true>
  >;

  if (!selectProps.collapseSelected) {
    return <BaseContainer {...props} />;
  }

  const valueList = Array.isArray(selectProps.value)
    ? (selectProps.value as readonly OptionData[])
    : [];
  const currentIndex = valueList.findIndex(
    (option: OptionData) => option.value === props.data.value
  );
  const targetIndex = Math.max(selectProps.visibleCount - 1, 0);
  const showIndicator =
    selectProps.collapsedCount > 0 &&
    selectProps.visibleCount > 0 &&
    currentIndex >= 0 &&
    currentIndex === targetIndex;

  return (
    <BaseContainer {...props}>
      {props.children}
      {showIndicator ? (
        <CollapsedIndicator collapsedCount={selectProps.collapsedCount} />
      ) : null}
    </BaseContainer>
  );
};

const CollapsibleMultiValue = (props: MultiValueProps<OptionData, true>) => {
  const selectProps = props.selectProps as DropdownSelectProps;
  const BaseMultiValue = SelectComponents.MultiValue as ComponentType<
    MultiValueProps<OptionData, true>
  >;

  const cutoff = selectProps.visibleCount;
  const hideCompletely =
    selectProps.collapseSelected &&
    !selectProps.isMeasuring &&
    props.index >= cutoff;
  if (hideCompletely) return null;

  const shouldMaskDuringMeasure =
    // When measuring we keep overflowed chips in the DOM (so measurements are accurate)
    // but make them invisible to avoid flicker.
    selectProps.collapseSelected &&
    selectProps.isMeasuring &&
    props.index >= cutoff;

  const innerPropsStyle =
    props.innerProps && 'style' in props.innerProps
      ? (props.innerProps.style as React.CSSProperties | undefined)
      : undefined;

  type MultiValueInnerProps = typeof props.innerProps & {
    style?: React.CSSProperties;
    'data-feathery-multi-value'?: string;
  };

  const mergedInnerProps: MultiValueInnerProps = {
    ...props.innerProps,
    'data-feathery-multi-value': 'true'
  };
  mergedInnerProps.onMouseDown = (event) => {
    event.stopPropagation();
    props.innerProps?.onMouseDown?.(event);
  };
  mergedInnerProps.onTouchStart = (event) => {
    event.stopPropagation();
    props.innerProps?.onTouchStart?.(event);
  };
  if (shouldMaskDuringMeasure) {
    mergedInnerProps.style = {
      ...innerPropsStyle,
      opacity: 0,
      pointerEvents: 'none'
    };
  } else if (innerPropsStyle) {
    mergedInnerProps.style = innerPropsStyle;
  }

  return (
    <BaseMultiValue
      {...props}
      selectProps={selectProps}
      innerProps={mergedInnerProps}
    />
  );
};

export {
  CollapsibleMultiValue,
  CollapsibleMultiValueContainer,
  TooltipOption,
  CollapsibleMultiValueRemove
};

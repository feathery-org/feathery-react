import React, { ComponentType, useRef, useState } from 'react';
import {
  components as SelectComponents,
  type ControlProps,
  type MultiValueGenericProps,
  type MultiValueProps,
  type MultiValueRemoveProps,
  type OptionProps
} from 'react-select';

import type { DropdownSelectProps, OptionData } from './types';
import Overlay from '../../components/Overlay';
import { Tooltip } from '../../components/Tooltip';
import { FORM_Z_INDEX } from '../../../utils/styles';

const TooltipOption = ({
  children,
  ...props
}: OptionProps<OptionData, true>) => {
  const BaseOption = SelectComponents.Option as ComponentType<
    OptionProps<OptionData, true>
  >;
  const optionRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const { containerRef } = props.selectProps as DropdownSelectProps;

  return (
    <div
      ref={optionRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <BaseOption {...props}>{children}</BaseOption>
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
  const selectProps = props.selectProps as DropdownSelectProps;
  if (!selectProps.collapseSelected) {
    return <BaseMultiValueRemove {...props} />;
  }

  const removeInnerProps = {
    ...props.innerProps,
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
      selectProps.onMultiValueRemovePointer?.();
      event.preventDefault();
      event.stopPropagation();
      props.innerProps?.onMouseDown?.(event);
    },
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      selectProps.onMultiValueRemovePointer?.();
      if (event.pointerType === 'touch') {
        event.preventDefault();
      }
      event.stopPropagation();
      props.innerProps?.onPointerDown?.(event);
    },
    'data-feathery-multi-value-remove': 'true'
  };

  return <BaseMultiValueRemove {...props} innerProps={removeInnerProps} />;
};

const Control = (props: ControlProps<OptionData, true>) => {
  const BaseControl = SelectComponents.Control as ComponentType<
    ControlProps<OptionData, true>
  >;
  const selectProps = props.selectProps as DropdownSelectProps;
  const { onControlPress } = selectProps;

  const toggleCollapse = (
    event: React.SyntheticEvent,
    isTouch: boolean
  ): boolean => {
    if (!onControlPress?.(event, { isTouch })) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  return (
    <BaseControl
      {...props}
      innerProps={{
        ...props.innerProps,
        onPointerDown: (event) => {
          if (!toggleCollapse(event, event.pointerType === 'touch')) {
            props.innerProps?.onPointerDown?.(event);
          }
        },
        onMouseDown: (event) => {
          if (!toggleCollapse(event, false)) {
            props.innerProps?.onMouseDown?.(event);
          }
        },
        onTouchStart: (event) => {
          if (!toggleCollapse(event, true)) {
            props.innerProps?.onTouchStart?.(event);
          }
        }
      }}
    />
  );
};

const CollapsedIndicator = ({
  collapsedCount,
  onPress
}: {
  collapsedCount: number;
  onPress?: (event: React.SyntheticEvent) => void;
}) =>
  collapsedCount > 0 ? (
    <span
      aria-hidden='true'
      className='rs-collapsed-chip'
      data-feathery-collapsed-indicator='true'
      /* eslint-disable-next-line react/no-unknown-property */
      onPointerDown={(event) => {
        if (!onPress) return;
        if (event.pointerType === 'touch') {
          event.preventDefault();
        }
        event.stopPropagation();
        onPress(event);
      }}
      onMouseDown={(event) => {
        if (!onPress) return;
        event.preventDefault();
        event.stopPropagation();
        onPress(event);
      }}
      onTouchStart={(event) => {
        if (!onPress) return;
        event.stopPropagation();
        onPress(event);
      }}
      onClick={(event) => {
        if (!onPress) return;
        event.stopPropagation();
        onPress(event);
      }}
    >
      +{collapsedCount}
    </span>
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
    !selectProps.isMeasuring &&
    selectProps.visibleCount > 0 &&
    currentIndex >= 0 &&
    currentIndex === targetIndex;

  const containerElement = (
    <BaseContainer {...props}>{props.children}</BaseContainer>
  );

  if (!showIndicator) return containerElement;

  return (
    <>
      {containerElement}
      <CollapsedIndicator
        collapsedCount={selectProps.collapsedCount}
        onPress={selectProps.onCollapsedChipPress}
      />
    </>
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

  const originalPointerDown = (
    props.innerProps as {
      onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
    }
  )?.onPointerDown;

  const mergedInnerProps: MultiValueInnerProps = {
    ...props.innerProps,
    'data-feathery-multi-value': 'true'
  };
  const shouldBubblePointer = selectProps.collapseSelected;
  mergedInnerProps.onPointerDown = (event) => {
    if (shouldBubblePointer) {
      if (event.pointerType === 'touch') {
        event.preventDefault();
      }
      event.stopPropagation();
      selectProps.onCollapsedChipPress?.(event);
      return;
    }

    event.stopPropagation();
    originalPointerDown?.(event);
  };
  mergedInnerProps.onMouseDown = (event) => {
    if (shouldBubblePointer) {
      event.preventDefault();
      event.stopPropagation();
      selectProps.onCollapsedChipPress?.(event);
      return;
    }

    event.stopPropagation();
    props.innerProps?.onMouseDown?.(event);
  };
  mergedInnerProps.onTouchStart = (event) => {
    if (shouldBubblePointer) {
      event.stopPropagation();
      selectProps.onCollapsedChipPress?.(event);
      return;
    }

    event.stopPropagation();
    props.innerProps?.onTouchStart?.(event);
  };
  if (shouldMaskDuringMeasure) {
    mergedInnerProps.style = {
      ...innerPropsStyle,
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
      left: 0,
      top: 0
    };
  } else if (hideCompletely) {
    mergedInnerProps.style = {
      ...innerPropsStyle,
      display: 'none'
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
  Control,
  CollapsibleMultiValue,
  CollapsibleMultiValueContainer,
  CollapsibleMultiValueRemove,
  TooltipOption
};

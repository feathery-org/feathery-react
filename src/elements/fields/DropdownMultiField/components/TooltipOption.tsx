import React, { useRef, useState } from 'react';
import { components as SelectComponents, OptionProps } from 'react-select';
import { OptionData } from '../DropdownMultiField';
import Overlay from '../../../components/Overlay';
import { Tooltip } from '../../../components/Tooltip';
import { FORM_Z_INDEX } from '../../../../utils/styles';

const TooltipOption = ({ children, ...props }: OptionProps<OptionData>) => {
  const optionRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      ref={optionRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* @ts-ignore */}
      <SelectComponents.Option {...props}>{children}</SelectComponents.Option>
      {props.data.tooltip && optionRef.current && (
        <Overlay
          targetRef={optionRef}
          // @ts-expect-error
          containerRef={props.selectProps.containerRef}
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

export default TooltipOption;

import React, { memo, useCallback, useState } from 'react';
import { DROPDOWN_Z_INDEX } from '..';
import Overlay from '../../components/Overlay';

function TextAutocomplete({
  allOptions = [],
  showOptions,
  onSelect = () => {},
  onHide = () => {},
  onInputFocus = () => {},
  value = '',
  container,
  responsiveStyles,
  listItemRef,
  children
}: {
  allOptions: string[];
  showOptions: boolean;
  onSelect: (a: string) => void;
  onHide: () => void;
  onInputFocus: () => void;
  value: string;
  container?: any;
  responsiveStyles: any;
  listItemRef: any;
  children: any;
}) {
  const options = allOptions.filter((opt) =>
    opt.toLowerCase().includes(value.toLowerCase())
  );

  // using ref callback strategy here to handle rerendering
  // when trigger is rendered or changes
  const [triggerElement, setTriggerElement] = useState<HTMLDivElement | null>(
    null
  );
  const triggerRef = useCallback((node: HTMLDivElement | null) => {
    setTriggerElement(node);
  }, []);

  if (allOptions.length === 0) return children;

  return (
    <div ref={triggerRef} css={{ height: '100%', width: '100%' }}>
      {children}
      {triggerElement && options.length > 0 && showOptions && (
        <Overlay
          target={triggerElement}
          container={triggerElement}
          show
          placement='bottom-start'
        >
          <ul
            css={{
              zIndex: DROPDOWN_Z_INDEX,
              listStyleType: 'none',
              padding: 0,
              margin: 0,
              maxHeight: '210px',
              overflowY: 'scroll',
              overflowX: 'auto',
              width: '400px',
              backgroundColor: 'white',
              cursor: 'pointer',
              boxShadow: '0 0 4px rgb(0 0 0 / 15%)',
              ...responsiveStyles.getTarget('dropdown')
            }}
          >
            {options.map((opt, index) => (
              <li
                key={`${opt}-${index}`}
                css={{
                  padding: '8px 14px',
                  transition: '0.1s ease all',
                  '&:hover': { backgroundColor: '#e6e6e633' },
                  '&:focus-visible': {
                    outline: 'none',
                    backgroundColor: '#e6e6e644'
                  }
                }}
                tabIndex={0}
                ref={(ref) => {
                  listItemRef.current[index] = ref;
                }}
                onClick={() => onSelect(opt)}
                onKeyDown={(e) => {
                  const disable = () => {
                    e.preventDefault();
                    e.stopPropagation();
                  };
                  if (e.key === 'Enter') {
                    disable();
                    onSelect(opt);
                  } else if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
                    disable();
                    listItemRef.current[index].nextSibling?.focus();
                  } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
                    disable();
                    if (index === 0) onInputFocus();
                    else listItemRef.current[index].previousSibling?.focus();
                  }
                }}
                onBlur={(e) => {
                  if (
                    !e.relatedTarget ||
                    !listItemRef.current.some(
                      (item: any) => item === e.relatedTarget
                    )
                  ) {
                    onHide();
                  }
                }}
              >
                {opt}
              </li>
            ))}
          </ul>
        </Overlay>
      )}
    </div>
  );
}

export default memo(TextAutocomplete);

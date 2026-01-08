import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fieldValues } from '../../../utils/init';
import {
  actionButtonStyle,
  actionMenuStyle,
  actionMenuItemStyle,
  actionContainerStyle,
  menuIconStyle,
  actionIconButtonStyle
} from './styles';
import { Action, Column } from './types';
import { featheryDoc } from '../../../utils/browser';

function MenuIcon() {
  return (
    <svg css={menuIconStyle} fill='currentColor' viewBox='0 0 24 24'>
      <circle cx='12' cy='5' r='2' />
      <circle cx='12' cy='12' r='2' />
      <circle cx='12' cy='19' r='2' />
    </svg>
  );
}

type ActionButtonsProps = {
  actions: Action[];
  rowIndex: number;
  columnData: Column[];
  fieldValues?: Record<string, any>;
  onClick: (data: any) => void | Promise<void>;
  forceInlineButtons?: boolean;
  tableId?: string;
  buttonLoaders?: Record<string, any>;
};

export function ActionButtons({
  actions,
  rowIndex,
  columnData,
  fieldValues: fieldValuesProp,
  onClick,
  forceInlineButtons = false,
  tableId = '',
  buttonLoaders = {}
}: ActionButtonsProps) {
  if (actions.length === 0) return null;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const useOverflow = !forceInlineButtons && actions.length > 1;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      featheryDoc().addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      featheryDoc().removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleActionClick = (action: Action) => {
    setIsMenuOpen(false);

    const activeFieldValues = fieldValuesProp || fieldValues;

    const rowData: Record<string, any> = {};
    columnData.forEach((col) => {
      const fValue = activeFieldValues[col.field_key];
      const cValue = Array.isArray(fValue) ? fValue[rowIndex] : fValue;
      rowData[col.name] = cValue;
    });

    onClick({
      action: action.label,
      rowIndex,
      rowData
    });
  };

  const handleMenuToggle = () => {
    if (!isMenuOpen && menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right
      });
    }
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <div ref={containerRef} css={actionContainerStyle}>
      {useOverflow ? (
        <>
          <button
            ref={menuButtonRef}
            type='button'
            onClick={(e) => {
              e.stopPropagation();
              handleMenuToggle();
            }}
            css={actionIconButtonStyle}
          >
            <MenuIcon />
          </button>
          {isMenuOpen &&
            createPortal(
              <div
                ref={menuRef}
                css={{
                  ...actionMenuStyle,
                  top: `${menuPosition.top}px`,
                  left: `${menuPosition.left}px`,
                  transform: 'translateX(-100%)'
                }}
              >
                {actions.map((action, index) => {
                  const buttonKey = `${tableId}_${rowIndex}_${action.label}`;
                  const loader = buttonLoaders[buttonKey]?.loader;
                  const disabled = Object.keys(buttonLoaders).length > 0;
                  return (
                    <button
                      key={index}
                      type='button'
                      onClick={() => handleActionClick(action)}
                      css={actionMenuItemStyle}
                      disabled={disabled}
                    >
                      <span css={{ flex: 1 }}>{action.label}</span>
                      {loader && (
                        <div
                          style={{
                            height: '16px',
                            width: '16px',
                            flexShrink: 0
                          }}
                        >
                          {loader}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>,
              featheryDoc().body
            )}
        </>
      ) : (
        actions.map((action, index) => {
          const buttonKey = `${tableId}_${rowIndex}_${action.label}`;
          const loader = buttonLoaders[buttonKey]?.loader;
          const disabled = Object.keys(buttonLoaders).length > 0;
          return (
            <button
              key={index}
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                handleActionClick(action);
              }}
              css={actionButtonStyle}
              disabled={disabled}
            >
              <span style={{ visibility: loader ? 'hidden' : 'visible' }}>
                {action.label}
              </span>
              {loader && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    height: '16px',
                    width: '16px'
                  }}
                >
                  {loader}
                </div>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

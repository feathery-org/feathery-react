import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';

type Action = {
  label: string;
};

type FieldDisplayColumn = {
  name: string;
  type: 'field_display';
  field_id: string;
  field_type: string;
  field_key: string;
};

type ActionColumn = {
  name: string;
  type: 'action';
  actions: Action[];
};

type Column = FieldDisplayColumn | ActionColumn;

function applyTableStyles(responsiveStyles: any) {
  responsiveStyles.addTargets(
    'tableContainer',
    'table',
    'thead',
    'tbody',
    'th',
    'td',
    'tr'
  );
  return responsiveStyles;
}

function ActionButtons({
  actions,
  rowIndex,
  column,
  columnData,
  onClick
}: {
  actions: Action[];
  rowIndex: number;
  column: ActionColumn;
  columnData: Column[];
  onClick?: (payload: any) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [visibleActions, setVisibleActions] = useState(actions);
  const [overflowActions, setOverflowActions] = useState<Action[]>([]);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    // Simple heuristic: show first 2 actions, overflow the rest
    // In a production app, you'd measure actual widths
    const maxVisible = 2;
    if (actions.length > maxVisible) {
      setVisibleActions(actions.slice(0, maxVisible));
      setOverflowActions(actions.slice(maxVisible));
    } else {
      setVisibleActions(actions);
      setOverflowActions([]);
    }
  }, [actions]);

  const handleActionClick = (action: Action) => {
    // console.log(`Action ${action.label} clicked for row ${rowIndex}`);
    setIsMenuOpen(false);

    if (!onClick) return;

    // Build row_data object with all field_display column values for this row
    const row_data: Record<string, any> = {};
    columnData.forEach((col) => {
      if (col.type === 'field_display') {
        const fieldValue = fieldValues[col.field_key];
        const cellValue = Array.isArray(fieldValue)
          ? fieldValue[rowIndex]
          : fieldValue;
        row_data[col.name] = cellValue;
      }
    });

    onClick({
      row: rowIndex,
      action: action.label,
      column: column.name,
      row_data
    });
  };

  const buttonStyles = {
    paddingLeft: '12px',
    paddingRight: '12px',
    paddingTop: '6px',
    paddingBottom: '6px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    '&:hover': {
      backgroundColor: '#f3f4f6',
      borderColor: '#9ca3af'
    }
  };

  return (
    <div
      ref={containerRef}
      css={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
      }}
    >
      {visibleActions.map((action, index) => (
        <button
          key={index}
          type='button'
          onClick={() => handleActionClick(action)}
          css={buttonStyles}
        >
          {action.label}
        </button>
      ))}
      {overflowActions.length > 0 && (
        <>
          <button
            ref={menuButtonRef}
            type='button'
            onClick={() => {
              if (!isMenuOpen && menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                setMenuPosition({
                  top: rect.bottom + 4,
                  left: rect.right
                });
              }
              setIsMenuOpen(!isMenuOpen);
            }}
            css={{
              ...buttonStyles,
              paddingLeft: '10px',
              paddingRight: '10px'
            }}
          >
            •••
          </button>
          {isMenuOpen &&
            createPortal(
              <div
                ref={menuRef}
                css={{
                  position: 'fixed',
                  top: `${menuPosition.top}px`,
                  left: `${menuPosition.left}px`,
                  transform: 'translateX(-100%)',
                  backgroundColor: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  zIndex: 9999,
                  minWidth: '120px'
                }}
              >
                {overflowActions.map((action, index) => (
                  <button
                    key={index}
                    type='button'
                    onClick={() => handleActionClick(action)}
                    css={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      paddingLeft: '12px',
                      paddingRight: '12px',
                      paddingTop: '8px',
                      paddingBottom: '8px',
                      fontSize: '14px',
                      color: '#374151',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        backgroundColor: '#f3f4f6'
                      },
                      '&:first-of-type': {
                        borderTopLeftRadius: '4px',
                        borderTopRightRadius: '4px'
                      },
                      '&:last-of-type': {
                        borderBottomLeftRadius: '4px',
                        borderBottomRightRadius: '4px'
                      }
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>,
              document.body
            )}
        </>
      )}
    </div>
  );
}

function TableElement({
  element,
  responsiveStyles,
  elementProps = {},
  onClick = () => {}
}: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const columnData: Column[] = element.properties?.columns || []; //defaultColumnData;

  const numRows = columnData.reduce((maxRows, column) => {
    if (column.type === 'field_display') {
      const fieldValue = fieldValues[column.field_key];
      if (Array.isArray(fieldValue)) {
        return Math.max(maxRows, fieldValue.length);
      }
    }
    return maxRows;
  }, 0);

  return (
    <div
      css={{
        position: 'relative',
        overflowX: 'auto',
        width: '100%',
        height: '100%',
        ...styles.getTarget('tableContainer')
      }}
      {...elementProps}
    >
      <table
        css={{
          backgroundColor: '#e5e7eb',
          borderWidth: 1,
          borderColor: '#a1a3a6',
          width: '100%',
          fontSize: '14px',
          textAlign: 'left',
          color: '#6b7280',
          ...styles.getTarget('table')
        }}
      >
        <thead
          css={{
            fontSize: '14px',
            color: '#6b7280',
            backgroundColor: '#f3f4f6',
            borderBottom: '1px solid #e5e7eb',
            ...styles.getTarget('thead')
          }}
        >
          <tr>
            {columnData.map((column, index) => (
              <th
                key={index}
                scope='col'
                css={{
                  paddingLeft: '24px',
                  paddingRight: '24px',
                  paddingTop: '12px',
                  paddingBottom: '12px',
                  fontWeight: 500,
                  textAlign: 'left',
                  ...styles.getTarget('th')
                }}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody css={styles.getTarget('tbody')}>
          {Array.from({ length: numRows }).map((_, rowIndex) => {
            const isLastRow = rowIndex === numRows - 1;
            return (
              <tr
                key={rowIndex}
                css={{
                  backgroundColor: '#ffffff',
                  ...(isLastRow ? {} : { borderBottom: '1px solid #e5e7eb' })
                }}
              >
                {columnData.map((column, colIndex) => {
                  if (column.type === 'action') {
                    return (
                      <td
                        key={colIndex}
                        css={{
                          paddingLeft: '24px',
                          paddingRight: '24px',
                          paddingTop: '16px',
                          paddingBottom: '16px',
                          ...styles.getTarget('td')
                        }}
                      >
                        <ActionButtons
                          actions={column.actions}
                          rowIndex={rowIndex}
                          column={column}
                          columnData={columnData}
                          onClick={onClick}
                        />
                      </td>
                    );
                  }

                  // Handle field_display columns
                  const fieldValue = fieldValues[column.field_key];
                  const cellValue = Array.isArray(fieldValue)
                    ? fieldValue[rowIndex]
                    : fieldValue;

                  // Build row_data for cell clicks
                  const handleCellClick = () => {
                    const row_data: Record<string, any> = {};
                    columnData.forEach((col) => {
                      if (col.type === 'field_display') {
                        const fValue = fieldValues[col.field_key];
                        const cValue = Array.isArray(fValue)
                          ? fValue[rowIndex]
                          : fValue;
                        row_data[col.name] = cValue;
                      }
                    });

                    onClick({
                      row: rowIndex,
                      column: column.name,
                      cell_data: cellValue,
                      row_data
                    });
                  };

                  return (
                    <td
                      key={colIndex}
                      onClick={handleCellClick}
                      css={{
                        paddingLeft: '24px',
                        paddingRight: '24px',
                        paddingTop: '16px',
                        paddingBottom: '16px',
                        ...styles.getTarget('td')
                      }}
                    >
                      {/* TODO: display all values properly (e.g. images) */}
                      {stringifyWithNull(cellValue) ?? ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TableElement;

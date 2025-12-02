import { useMemo } from 'react';
import { fieldValues } from '../../../utils/init';

type Column = {
  display: string;
  fieldKey: string;
};

const defaultColumnData = [
  {
    display: 'Product name',
    fieldKey: 'table_column_a'
  },
  {
    display: 'Color',
    fieldKey: 'table_column_b'
  },
  {
    display: 'Category',
    fieldKey: 'table_column_c'
  },
  {
    display: 'Price',
    fieldKey: 'table_column_d'
  },
  {
    display: 'Stock',
    fieldKey: 'table_column_e'
  }
];

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
  responsiveStyles.applyFontStyles('tableContainer');
  responsiveStyles.applyWidth('tableContainer');
  return responsiveStyles;
}

function TableElement({ element, responsiveStyles, elementProps = {} }: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const columnData: Column[] =
    element.properties?.column_data || defaultColumnData;

  // Get the maximum number of rows across all columns to handle different lengths
  const numRows = columnData.reduce((maxRows, column) => {
    const fieldValue = fieldValues[column.fieldKey];
    if (Array.isArray(fieldValue)) {
      return Math.max(maxRows, fieldValue.length);
    }
    return maxRows;
  }, 0);

  return (
    <div
      css={{
        position: 'relative',
        overflowX: 'auto',
        backgroundColor: '#f9fafb',
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        borderRadius: '8px',
        border: '1px solid #e5e7eb',
        ...styles.getTarget('tableContainer')
      }}
      {...elementProps}
    >
      <table
        css={{
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
                {column.display}
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
                  const fieldValue = fieldValues[column.fieldKey];
                  const cellValue = Array.isArray(fieldValue)
                    ? fieldValue[rowIndex]
                    : fieldValue;

                  const isFirstColumn = colIndex === 0;

                  return isFirstColumn ? (
                    <th
                      key={colIndex}
                      scope='row'
                      css={{
                        paddingLeft: '24px',
                        paddingRight: '24px',
                        paddingTop: '16px',
                        paddingBottom: '16px',
                        fontWeight: 500,
                        color: '#111827',
                        whiteSpace: 'nowrap',
                        textAlign: 'left',
                        ...styles.getTarget('th')
                      }}
                    >
                      {cellValue ?? ''}
                    </th>
                  ) : (
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
                      {cellValue ?? ''}
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

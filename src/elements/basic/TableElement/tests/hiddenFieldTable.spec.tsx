import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
import {
  INVALID_FORMAT_MESSAGE,
  parseHiddenFieldRows
} from '../useHiddenFieldTableSource';
import { EDITABLE_CELL_VALUE_TYPES } from '../spreadsheet/validation';

const HIDDEN_KEY = 'table_grid';

const COLUMNS = [
  { name: 'Name', field_type: 'text' },
  { name: 'Age', field_type: 'number' },
  { name: 'Email', field_type: 'email' }
];

const table = (values: any[][]) => ({ columns: COLUMNS, values });

const makeElement = (propsOverride: Record<string, any> = {}) => ({
  id: 'table1',
  properties: {
    columns: [],
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: true,
    add_delete_rows: true,
    data_source: 'hidden_field',
    hidden_field_id: 'hf-uuid',
    hidden_field_key: HIDDEN_KEY,
    ...propsOverride
  }
});

const mockStyles = () => ({
  addTargets: jest.fn(),
  apply: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

// Mirrors the form: an update lands in the global field values straight away.
const mockUpdateFieldValues = () =>
  jest.fn((values: Record<string, any>) => Object.assign(fieldValues, values));

const renderTable = (propsOverride: Record<string, any> = {}) => {
  const updateFieldValues = mockUpdateFieldValues();
  const submitCustom = jest.fn();
  const view = render(
    <TableElement
      element={makeElement(propsOverride)}
      responsiveStyles={mockStyles()}
      updateFieldValues={updateFieldValues}
      submitCustom={submitCustom}
    />
  );
  return { ...view, updateFieldValues, submitCustom };
};

const editCell = (text: string, value: string) => {
  fireEvent.click(screen.getByText(text));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('TableElement - hidden field data source', () => {
  beforeEach(() => {
    Object.assign(fieldValues, {
      [HIDDEN_KEY]: table([
        ['Alice', 30, 'alice@x.co'],
        ['Bob', 41]
      ])
    });
  });

  afterEach(() => {
    delete (fieldValues as any)[HIDDEN_KEY];
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('takes column names from "columns" and rows from "values"', () => {
    const { container } = renderTable();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('alice@x.co');
    expect(rows[1].textContent).toContain('41');
  });

  it('stores a valid edit with the columns kept and the value typed', () => {
    const { updateFieldValues, submitCustom } = renderTable();

    editCell('30', '31');

    const expected = {
      [HIDDEN_KEY]: table([
        ['Alice', 31, 'alice@x.co'],
        ['Bob', 41]
      ])
    };
    expect(updateFieldValues).toHaveBeenLastCalledWith(expected);
    expect(submitCustom).toHaveBeenLastCalledWith(expected);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("refuses an edit that does not match its column's type", () => {
    const { updateFieldValues, submitCustom } = renderTable();

    editCell('30', 'thirty');

    expect(updateFieldValues).not.toHaveBeenCalled();
    expect(submitCustom).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Age, row 1: Must be a number'
    );
    expect(screen.getByText('30')).toBeInTheDocument();

    // The next valid edit clears the message.
    editCell('alice@x.co', 'alice@y.co');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submitCustom).toHaveBeenLastCalledWith({
      [HIDDEN_KEY]: table([
        ['Alice', 30, 'alice@y.co'],
        ['Bob', 41]
      ])
    });
  });

  it('adds a provisional empty row sized to the columns', () => {
    const { updateFieldValues, submitCustom } = renderTable();

    fireEvent.click(screen.getByRole('button', { name: '+ Add Row' }));

    expect(updateFieldValues).toHaveBeenLastCalledWith({
      [HIDDEN_KEY]: table([
        ['', '', ''],
        ['Alice', 30, 'alice@x.co'],
        ['Bob', 41]
      ])
    });
    expect(submitCustom).not.toHaveBeenCalled();
  });

  it('deletes a row and submits the rest with the columns', () => {
    const { container, submitCustom } = renderTable();

    fireEvent.click(
      container.querySelector('.feathery-table-delete-button') as HTMLElement
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(submitCustom).toHaveBeenLastCalledWith({
      [HIDDEN_KEY]: table([['Bob', 41]])
    });
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('lists stored cells that do not match their type once loaded', () => {
    (fieldValues as any)[HIDDEN_KEY] = table([
      ['Alice', 'old', 'alice@x.co'],
      ['Bob', 41, 'nope']
    ]);
    const { updateFieldValues } = renderTable();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Age, row 1: Must be a number');
    expect(alert).toHaveTextContent('Email, row 2: Invalid email');
    // Checking is not an edit: nothing is written back.
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  it('does not list stored cells that fit their type', () => {
    renderTable();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('flags stored cells that do not match their type in a spreadsheet', () => {
    // jsdom lays nothing out, so the grid's virtualizers would render no cells
    // without a viewport.
    const sizes = ['offsetWidth', 'offsetHeight'] as const;
    const originals = sizes.map((prop) =>
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
    );
    sizes.forEach((prop) =>
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get: () => (prop === 'offsetWidth' ? 900 : 600)
      })
    );
    try {
      (fieldValues as any)[HIDDEN_KEY] = table([['Alice', 'old', 'nope']]);
      renderTable({ display_mode: 'spreadsheet' });

      const cell = (text: string) =>
        screen.getByText(text).closest('[role="gridcell"]');
      expect(cell('old')).toHaveAttribute('title', 'Must be a number');
      expect(cell('nope')).toHaveAttribute('title', 'Invalid email');
      expect(cell('Alice')).not.toHaveAttribute('title');
      // The cells carry the errors, so there is no list of them as well.
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      sizes.forEach((prop, index) => {
        const original = originals[index];
        if (original) {
          Object.defineProperty(HTMLElement.prototype, prop, original);
        }
      });
    }
  });

  describe('a required column', () => {
    const REQUIRED_COLUMNS = [
      { name: 'Name', field_type: 'text', required: true },
      { name: 'Age', field_type: 'number' }
    ];

    beforeEach(() => {
      (fieldValues as any)[HIDDEN_KEY] = {
        columns: REQUIRED_COLUMNS,
        values: [['Alice', 30]]
      };
    });

    it('flags its blank cell as soon as a row is added in a spreadsheet', () => {
      const sizes = ['offsetWidth', 'offsetHeight'] as const;
      const originals = sizes.map((prop) =>
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
      );
      sizes.forEach((prop) =>
        Object.defineProperty(HTMLElement.prototype, prop, {
          configurable: true,
          get: () => (prop === 'offsetWidth' ? 900 : 600)
        })
      );
      try {
        const { container } = renderTable({ display_mode: 'spreadsheet' });
        const cell = (row: number, column: number) =>
          container.querySelector(
            `[data-row-id="r${row}"][data-column-id="__hidden_field_column_${column}"]`
          );
        expect(cell(0, 0)).not.toHaveAttribute('title');

        fireEvent.click(screen.getByRole('button', { name: '+ Add row' }));

        expect(cell(1, 0)).toHaveAttribute('title', 'Required');
        // A blank cell in a column that is not required is fine.
        expect(cell(1, 1)).not.toHaveAttribute('title');
      } finally {
        sizes.forEach((prop, index) => {
          const original = originals[index];
          if (original) {
            Object.defineProperty(HTMLElement.prototype, prop, original);
          }
        });
      }
    });

    it('refuses clearing its cell in a classic table', () => {
      const { updateFieldValues } = renderTable();

      editCell('Alice', '');

      expect(updateFieldValues).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Name, row 1: Required'
      );
    });

    it('lists its blank stored cells once loaded', () => {
      (fieldValues as any)[HIDDEN_KEY] = {
        columns: REQUIRED_COLUMNS,
        values: [['', 30]]
      };
      renderTable();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Name, row 1: Required'
      );
    });
  });

  it('shows the empty state, not an error, when the hidden field has no value', () => {
    delete (fieldValues as any)[HIDDEN_KEY];
    renderTable();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['a bare 2D array', [['Name'], ['Alice']]],
    ['an object without columns', { values: [['a']] }],
    ['columns given as bare names', { columns: ['Name', 'Age'], values: [] }],
    [
      'an unknown column type',
      { columns: [{ name: 'Doc', field_type: 'file' }], values: [] }
    ],
    ['a row holding an object', table([['a', { b: 1 }]])],
    ['unparseable text', 'not json']
  ])('shows an error and stays read-only for %s', (_, value) => {
    (fieldValues as any)[HIDDEN_KEY] = value;
    const { updateFieldValues } = renderTable();

    expect(screen.getByRole('alert')).toHaveTextContent(INVALID_FORMAT_MESSAGE);
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add Row' })).toBeNull();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  describe('a column without a field_type', () => {
    const untyped = (fieldType?: any) => ({
      columns: [
        {
          name: 'Note',
          ...(fieldType === undefined ? {} : { field_type: fieldType })
        },
        { name: 'Age', field_type: 'number' }
      ],
      values: [['hello', 3]]
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', '']
    ])('is read as text when %s', (_, fieldType) => {
      (fieldValues as any)[HIDDEN_KEY] = untyped(fieldType);
      renderTable();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('Note')).toBeInTheDocument();
      expect(screen.getByText('hello')).toBeInTheDocument();
    });

    it('accepts any text and keeps the stored columns as they were', () => {
      const value = untyped();
      (fieldValues as any)[HIDDEN_KEY] = value;
      const { updateFieldValues } = renderTable();

      editCell('hello', '42 apples');

      expect(updateFieldValues).toHaveBeenLastCalledWith({
        [HIDDEN_KEY]: { columns: value.columns, values: [['42 apples', 3]] }
      });
    });
  });

  describe('when the hidden field changes outside the table', () => {
    const rerenderTable = (view: ReturnType<typeof renderTable>) =>
      view.rerender(
        <TableElement
          element={makeElement()}
          responsiveStyles={mockStyles()}
          updateFieldValues={view.updateFieldValues}
          submitCustom={view.submitCustom}
        />
      );

    it('shows a newly assigned value', () => {
      const view = renderTable();
      expect(screen.getByText('Alice')).toBeInTheDocument();

      (fieldValues as any)[HIDDEN_KEY] = table([['Carol', 25]]);
      rerenderTable(view);

      expect(screen.getByText('Carol')).toBeInTheDocument();
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });

    it('shows rows changed in place on the same object', () => {
      const view = renderTable();
      const stored = (fieldValues as any)[HIDDEN_KEY];

      // What `field.value.values = [...]` in a logic rule does
      stored.values = [['Dave', 52]];
      rerenderTable(view);
      expect(screen.getByText('Dave')).toBeInTheDocument();
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();

      // A cell changed deep inside the rows
      stored.values[0][0] = 'Erin';
      rerenderTable(view);
      expect(screen.getByText('Erin')).toBeInTheDocument();
      expect(screen.queryByText('Dave')).not.toBeInTheDocument();
    });

    it('shows added columns', () => {
      const view = renderTable();
      (fieldValues as any)[HIDDEN_KEY] = {
        columns: [...COLUMNS, { name: 'Active', field_type: 'boolean' }],
        values: [['Alice', 30, 'alice@x.co', true]]
      };
      rerenderTable(view);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows a JSON string value', () => {
      const view = renderTable();
      (fieldValues as any)[HIDDEN_KEY] = JSON.stringify(table([['Faye', 33]]));
      rerenderTable(view);
      expect(screen.getByText('Faye')).toBeInTheDocument();
    });

    it('clears when the value is cleared', () => {
      const view = renderTable();
      (fieldValues as any)[HIDDEN_KEY] = null;
      rerenderTable(view);
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });
  });

  it('previews one column saying data loads from the hidden field in the builder', () => {
    const { container } = render(
      <TableElement
        element={makeElement()}
        responsiveStyles={mockStyles()}
        editMode
      />
    );
    const dataHeaders = container.querySelectorAll('th[data-feathery-field]');
    expect(dataHeaders).toHaveLength(1);
    expect(dataHeaders[0]).toHaveTextContent(
      'Data is loaded from the hidden field'
    );
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('asks for a hidden field in the preview column when none is selected', () => {
    render(
      <TableElement
        element={makeElement({ hidden_field_id: undefined })}
        responsiveStyles={mockStyles()}
        editMode
      />
    );
    expect(
      screen.getByText('Select a hidden field to load data from')
    ).toBeInTheDocument();
  });

  it('previews two sample rows in the builder', () => {
    render(
      <TableElement
        element={makeElement()}
        responsiveStyles={mockStyles()}
        editMode
      />
    );
    expect(screen.getAllByText('Sample')).toHaveLength(2);
  });

  it('shows the add column button in the builder when columns can be added', () => {
    render(
      <TableElement
        element={makeElement({ enable_column_adding: true })}
        responsiveStyles={mockStyles()}
        editMode
      />
    );
    expect(
      screen.getByRole('button', { name: '+ Add Column' })
    ).toBeInTheDocument();
  });

});

describe('parseHiddenFieldRows', () => {
  it('reads columns and values, JSON or not', () => {
    const value = table([['a', 1, null], ['b']]);
    const expected = {
      header: COLUMNS,
      rows: [['a', 1, null], ['b']],
      error: null
    };
    expect(parseHiddenFieldRows(value)).toEqual(expected);
    expect(parseHiddenFieldRows(JSON.stringify(value))).toEqual(expected);
  });

  it('accepts columns without a field_type', () => {
    const columns = [{ name: 'Note' }];
    expect(parseHiddenFieldRows({ columns, values: [['x']] })).toEqual({
      header: columns,
      rows: [['x']],
      error: null
    });
  });

  it('accepts every cell type but file', () => {
    const types = Object.keys(EDITABLE_CELL_VALUE_TYPES);
    const columns = types.map((type) => ({ name: type, field_type: type }));
    expect(types).toContain('url');
    expect(types).not.toContain('file');
    expect(parseHiddenFieldRows({ columns }).error).toBeNull();
  });

  it('accepts a required flag, and an empty default for a required column', () => {
    const columns = [{ name: 'Name', required: true, default: '' }];
    expect(parseHiddenFieldRows({ columns }).error).toBeNull();
  });

  it('reports a required flag that is not true or false', () => {
    expect(
      parseHiddenFieldRows({ columns: [{ name: 'Name', required: 'yes' }] })
        .error
    ).toContain('Column 1 has required "yes"; use true or false.');
  });

  it('treats missing values as a table with no rows', () => {
    expect(parseHiddenFieldRows({ columns: COLUMNS })).toEqual({
      header: COLUMNS,
      rows: [],
      error: null
    });
  });

  it('treats no value as an empty grid', () => {
    [undefined, null, ''].forEach((value) =>
      expect(parseHiddenFieldRows(value)).toEqual({
        header: [],
        rows: [],
        error: null
      })
    );
  });

  it.each([
    ['not json', 'not valid JSON'],
    [[['a']], 'not an object'],
    [{ values: [] }, '"columns" is not a list of columns'],
    [{ columns: ['Name'] }, 'Column 1 is not a { name, field_type } object'],
    [{ columns: [{ field_type: 'text' }] }, 'Column 1 needs a text "name"'],
    [{ columns: [{ name: 'A', field_type: 7 }] }, 'Column 1 has field_type 7'],
    [
      {
        columns: [
          { name: 'A', field_type: 'text' },
          { name: 'B', field_type: 'money' }
        ]
      },
      'Column 2 has field_type "money"'
    ],
    [
      { columns: [{ name: 'A', field_type: 'file' }] },
      'Column 1 has field_type "file"'
    ],
    [{ columns: COLUMNS, values: 'rows' }, '"values" is not a list of rows'],
    [table(['row'] as any), 'Row 1 is not an array'],
    [table([['a'], [['nested']]]), 'Row 2 holds a value'],
    [
      table([['a', 1, 'e', 'extra']]),
      'Row 1 has 4 cells but there are only 3 columns'
    ]
  ])('explains why %j is invalid', (value, detail) => {
    const { error, rows } = parseHiddenFieldRows(value);
    expect(rows).toEqual([]);
    expect(error).toContain(INVALID_FORMAT_MESSAGE);
    expect(error).toContain(detail);
  });
});

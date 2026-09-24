import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

const HIDDEN_KEY = 'table_grid';

const COLUMNS = [
  { name: 'Name', field_type: 'text' },
  { name: 'Age', field_type: 'number' }
];

const ALL_COLUMN_OPTIONS = {
  enable_column_adding: true,
  enable_column_editing: true,
  enable_column_deletion: true
};

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

const renderTable = (propsOverride: Record<string, any> = {}) => {
  const updateFieldValues = jest.fn((values: Record<string, any>) =>
    Object.assign(fieldValues, values)
  );
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

const stored = () => (fieldValues as any)[HIDDEN_KEY];

const fillEditor = (name: string, type?: string) => {
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Name'), {
    target: { value: name }
  });
  if (type) {
    fireEvent.change(within(dialog).getByLabelText('Type'), {
      target: { value: type }
    });
  }
  return dialog;
};

// jsdom lays nothing out, so the grid's virtualizers would render no cells
// without a viewport.
const withViewport = (run: () => void) => {
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
    run();
  } finally {
    sizes.forEach((prop, index) => {
      const original = originals[index];
      if (original)
        Object.defineProperty(HTMLElement.prototype, prop, original);
    });
  }
};

beforeEach(() => {
  (fieldValues as any)[HIDDEN_KEY] = {
    columns: COLUMNS,
    values: [
      ['Alice', 30],
      ['Bob', 41]
    ]
  };
});

afterEach(() => {
  delete (fieldValues as any)[HIDDEN_KEY];
});

describe('hidden field table columns - classic', () => {
  it('offers no column controls unless the builder enables them', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: '+ Add Column' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit column/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete column/ })).toBeNull();
  });

  it('offers only the controls that are enabled', () => {
    renderTable({ enable_column_editing: true });
    expect(screen.queryByRole('button', { name: '+ Add Column' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit column Name' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete column/ })).toBeNull();
  });

  it('never offers column controls for a field-backed table', () => {
    renderTable({
      ...ALL_COLUMN_OPTIONS,
      data_source: 'fields',
      columns: [
        { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'f1' }
      ]
    });
    expect(screen.queryByRole('button', { name: '+ Add Column' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit column/ })).toBeNull();
  });

  it('offers no column controls while the stored value is unreadable', () => {
    (fieldValues as any)[HIDDEN_KEY] = 'not json';
    renderTable(ALL_COLUMN_OPTIONS);
    expect(screen.queryByRole('button', { name: '+ Add Column' })).toBeNull();
  });

  it('adds a column with its name and type and submits it', () => {
    const { submitCustom } = renderTable({ enable_column_adding: true });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Column' }));
    const dialog = fillEditor('Email', 'email');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    const expected = {
      columns: [...COLUMNS, { name: 'Email', field_type: 'email' }],
      values: [
        ['Alice', 30],
        ['Bob', 41]
      ]
    };
    expect(stored()).toEqual(expected);
    expect(submitCustom).toHaveBeenCalledWith({ [HIDDEN_KEY]: expected });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds the first column to an empty hidden field', () => {
    delete (fieldValues as any)[HIDDEN_KEY];
    renderTable({ enable_column_adding: true });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Column' }));
    fireEvent.click(
      within(fillEditor('Name')).getByRole('button', { name: 'Add' })
    );

    expect(stored()).toEqual({
      columns: [{ name: 'Name', field_type: 'text' }],
      values: []
    });
  });

  it('will not add a column without a name', () => {
    const { updateFieldValues } = renderTable({ enable_column_adding: true });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Column' }));
    const dialog = fillEditor('   ');
    const add = within(dialog).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.submit(dialog);
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  it('closes the editor without a change on Cancel', () => {
    const { updateFieldValues } = renderTable({ enable_column_adding: true });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Column' }));
    fireEvent.click(
      within(fillEditor('Email')).getByRole('button', { name: 'Cancel' })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  it('edits a column from its header, starting from its name and type', () => {
    renderTable({ enable_column_editing: true, sort: true });

    fireEvent.click(screen.getByRole('button', { name: 'Edit column Age' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit column' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Age');
    expect(within(dialog).getByLabelText('Type')).toHaveValue('number');

    fillEditor('Years', 'text');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(stored()).toEqual({
      columns: [COLUMNS[0], { name: 'Years', field_type: 'text' }],
      values: [
        ['Alice', 30],
        ['Bob', 41]
      ]
    });
    expect(screen.getByText('Years')).toBeInTheDocument();
  });

  it('opens the editor without sorting the column', () => {
    renderTable({ enable_column_editing: true, sort: true });
    fireEvent.click(screen.getByRole('button', { name: 'Edit column Name' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // A sorted column marks one of its arrows active.
    expect(document.querySelector('[data-active]')).toBeNull();
    // Whereas clicking the header itself does sort.
    fireEvent.click(screen.getByText('Age'));
    expect(document.querySelector('[data-active]')).not.toBeNull();
  });

  it('deletes a column and its cells after confirmation', () => {
    const { submitCustom } = renderTable({ enable_column_deletion: true });

    fireEvent.click(screen.getByRole('button', { name: 'Delete column Name' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete column "Name" and its values?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    const expected = { columns: [COLUMNS[1]], values: [[30], [41]] };
    expect(stored()).toEqual(expected);
    expect(submitCustom).toHaveBeenCalledWith({ [HIDDEN_KEY]: expected });
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('keeps the column when the delete is cancelled', () => {
    const { updateFieldValues } = renderTable({ enable_column_deletion: true });

    fireEvent.click(screen.getByRole('button', { name: 'Delete column Name' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Cancel'
      })
    );
    expect(updateFieldValues).not.toHaveBeenCalled();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('previews the controls in the builder without changing anything', () => {
    const updateFieldValues = jest.fn();
    render(
      <TableElement
        element={makeElement(ALL_COLUMN_OPTIONS)}
        responsiveStyles={mockStyles()}
        updateFieldValues={updateFieldValues}
        editMode
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add Column' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });
});

describe('hidden field table columns - spreadsheet', () => {
  const spreadsheet = (props: Record<string, any>) =>
    renderTable({ display_mode: 'spreadsheet', ...props });

  it('adds a column from the trailing header', () => {
    withViewport(() => {
      spreadsheet({ enable_column_adding: true });
      // The grid has its own add affordance, so the toolbar has none.
      expect(screen.queryByRole('button', { name: '+ Add Column' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
      fireEvent.click(
        within(fillEditor('Active', 'boolean')).getByRole('button', {
          name: 'Add'
        })
      );

      expect(stored().columns).toEqual([
        ...COLUMNS,
        { name: 'Active', field_type: 'boolean' }
      ]);
      expect(
        screen.getByRole('columnheader', { name: /Active/ })
      ).toBeInTheDocument();
    });
  });

  it('offers adding from the toolbar when there are no columns yet', () => {
    withViewport(() => {
      delete (fieldValues as any)[HIDDEN_KEY];
      spreadsheet({ enable_column_adding: true });
      expect(
        screen.getByRole('button', { name: '+ Add Column' })
      ).toBeInTheDocument();
    });
  });

  it('edits a column from the header hover button', () => {
    withViewport(() => {
      spreadsheet({ enable_column_editing: true });

      fireEvent.click(screen.getByRole('button', { name: 'Edit column Name' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit column' });
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Name');
      fillEditor('Full name');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(stored().columns[0]).toEqual({
        name: 'Full name',
        field_type: 'text'
      });
    });
  });

  it('edits and deletes from the header right-click menu', () => {
    withViewport(() => {
      spreadsheet({
        enable_column_editing: true,
        enable_column_deletion: true
      });

      const header = () => screen.getByRole('columnheader', { name: /Age/ });
      fireEvent.contextMenu(header());
      const menu = screen.getByRole('menu');
      expect(
        within(menu).getByRole('menuitem', { name: 'Edit column' })
      ).toBeInTheDocument();
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Delete column' })
      );

      const confirm = screen.getByRole('alertdialog');
      expect(confirm).toHaveTextContent('Delete column "Age" and its values?');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

      expect(stored()).toEqual({
        columns: [COLUMNS[0]],
        values: [['Alice'], ['Bob']]
      });
    });
  });

  it('inserts a column left or right from the header right-click menu', () => {
    withViewport(() => {
      spreadsheet({ enable_column_adding: true });

      const header = () => screen.getByRole('columnheader', { name: /Age/ });
      fireEvent.contextMenu(header());
      fireEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', {
          name: 'Insert column left'
        })
      );
      fireEvent.click(
        within(fillEditor('City')).getByRole('button', { name: 'Add' })
      );

      expect(stored()).toEqual({
        columns: [COLUMNS[0], { name: 'City', field_type: 'text' }, COLUMNS[1]],
        values: [
          ['Alice', '', 30],
          ['Bob', '', 41]
        ]
      });

      fireEvent.contextMenu(header());
      fireEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', {
          name: 'Insert column right'
        })
      );
      fireEvent.click(
        within(fillEditor('Active', 'boolean')).getByRole('button', {
          name: 'Add'
        })
      );

      expect(stored().columns).toEqual([
        COLUMNS[0],
        { name: 'City', field_type: 'text' },
        COLUMNS[1],
        { name: 'Active', field_type: 'boolean' }
      ]);
    });
  });

  it('offers no insert items unless adding columns is enabled', () => {
    withViewport(() => {
      spreadsheet({ enable_column_editing: true });
      fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Age/ }));
      expect(
        within(screen.getByRole('menu')).queryByRole('menuitem', {
          name: /Insert column/
        })
      ).toBeNull();
    });
  });

  it('holds back deleting a column while cell edits are unsaved', () => {
    withViewport(() => {
      spreadsheet({ enable_column_deletion: true });
      expect(
        screen.getByRole('button', { name: 'Delete column Name' })
      ).toBeInTheDocument();

      const cell = screen.getByText('Alice').closest('[role="gridcell"]')!;
      fireEvent.doubleClick(cell);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Alicia' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(
        screen.queryByRole('button', { name: /Delete column/ })
      ).toBeNull();
    });
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age_key' }
];

const HUB_COLUMNS = [
  {
    name: 'Name',
    field_id: '',
    field_type: '',
    field_key: '',
    hub_field_id: 'hf1',
    hub_field_key: 'name'
  },
  {
    name: 'Email',
    field_id: '',
    field_type: '',
    field_key: '',
    hub_field_id: 'hf2',
    hub_field_key: 'email'
  }
];

const seedFieldValues = () => {
  Object.assign(fieldValues, {
    name_key: ['Alice', 'Bob'],
    age_key: ['30', '40']
  });
};

const clearFieldValues = () => {
  delete (fieldValues as any).name_key;
  delete (fieldValues as any).age_key;
};

const makeElement = (propsOverride: Record<string, any> = {}) => ({
  id: 'table1',
  properties: {
    columns: COLUMNS,
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: false,
    ...propsOverride
  }
});

const makeHubElement = (propsOverride: Record<string, any> = {}) =>
  makeElement({
    columns: HUB_COLUMNS,
    data_source: 'hub',
    hub_id: 'hub1',
    enable_editing: true,
    add_delete_rows: true,
    ...propsOverride
  });

// applyTableStyles only calls addTargets and the render reads getTarget
const mockStyles = () => ({
  addTargets: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

describe('TableElement - onClick column payload', () => {
  beforeEach(() => {
    seedFieldValues();
  });

  afterEach(() => {
    clearFieldValues();
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('emits the clicked column for a normal-mode data-cell click (without double-firing the row handler)', () => {
    const onClick = jest.fn();
    render(
      <TableElement
        element={makeElement()}
        responsiveStyles={mockStyles()}
        onClick={onClick}
      />
    );

    // Cell at row 0, column "Age"
    fireEvent.click(screen.getByText('30'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({
      rowIndex: 0,
      rowData: { Name: 'Alice', Age: '30' },
      columnIndex: 1,
      columnKey: 'age_key',
      columnName: 'Age'
    });
  });

  it('emits the original column for a transposed-mode data-cell click', () => {
    const onClick = jest.fn();
    render(
      <TableElement
        element={makeElement({ transpose: true })}
        responsiveStyles={mockStyles()}
        onClick={onClick}
      />
    );

    // Transposed: rendered row 0 maps to original column "Name"; this cell holds
    // original row 0's value
    fireEvent.click(screen.getByText('Alice'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({
      rowIndex: 0,
      rowData: { Name: 'Alice', Age: '30' },
      columnIndex: 0,
      columnKey: 'name_key',
      columnName: 'Name'
    });
  });
});

describe('TableElement - buffered Data Hub edits', () => {
  afterEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('marks edited cells dirty and only updates Data Hub after Save', async () => {
    const dataHubAction = jest.fn(({ operation }) => {
      if (operation === 'get') {
        return Promise.resolve([
          { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } }
        ]);
      }
      return Promise.resolve({ updated: 1 });
    });
    const { container } = render(
      <TableElement
        element={makeHubElement()}
        responsiveStyles={mockStyles()}
        client={{ dataHubAction }}
      />
    );

    fireEvent.click(await screen.findByText('Alice'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(container.querySelector('[data-dirty="true"]')).toHaveTextContent(
      'Alicia'
    );
    expect(dataHubAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'update',
        where: [{ entryId: 'entry1' }],
        data: { name: 'Alicia' }
      })
    );
    await waitFor(() =>
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    );
  });

  it('restores the latest Data Hub snapshot on Reset', async () => {
    const dataHubAction = jest.fn(({ operation }) => {
      if (operation === 'get') {
        return Promise.resolve([
          { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } }
        ]);
      }
      return Promise.resolve(null);
    });
    render(
      <TableElement
        element={makeHubElement()}
        responsiveStyles={mockStyles()}
        client={{ dataHubAction }}
      />
    );

    fireEvent.click(await screen.findByText('Alice'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.queryByText('Alicia')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(dataHubAction).toHaveBeenCalledTimes(2);
  });

  it('keeps invalid new rows dirty and displays backend validation errors', async () => {
    const dataHubAction = jest.fn(({ operation }) => {
      if (operation === 'get') return Promise.resolve([]);
      if (operation === 'create') {
        return Promise.reject(new Error('Missing required fields: email'));
      }
      return Promise.resolve(null);
    });
    render(
      <TableElement
        element={makeHubElement()}
        responsiveStyles={mockStyles()}
        client={{ dataHubAction }}
      />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: '+ Add Row' })
    );
    fireEvent.click(screen.getAllByText('Click to edit')[0]);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Ayesha' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Row 1: Missing required fields: email')
    ).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('Ayesha')).toBeInTheDocument();
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'create',
      data: { name: 'Ayesha', email: '' }
    });
  });

  it('only deletes persisted rows from Data Hub after Save', async () => {
    const dataHubAction = jest.fn(({ operation }) => {
      if (operation === 'get') {
        return Promise.resolve([
          { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } }
        ]);
      }
      return Promise.resolve(null);
    });
    const { container } = render(
      <TableElement
        element={makeHubElement()}
        responsiveStyles={mockStyles()}
        client={{ dataHubAction }}
      />
    );

    await screen.findByText('Alice');
    fireEvent.click(
      container.querySelector(`.feathery-table-delete-button`) as HTMLElement
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(dataHubAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'delete',
        where: [{ entryId: 'entry1' }]
      })
    );
  });
});

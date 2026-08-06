import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TableGroup from './TableGroup';

// The exact editor surface TableGroup drives.
function makeEditor(): any {
  return {
    editor: {
      insertRow: jest.fn(),
      insertColumn: jest.fn(),
      deleteRow: jest.fn(),
      deleteColumn: jest.fn(),
      deleteTable: jest.fn(),
      mergeCells: jest.fn(),
      applyBorders: jest.fn()
    },
    selection: { cellFormat: {}, tableFormat: {} }
  };
}

function renderGroup(overrides: Partial<any> = {}) {
  const editor = makeEditor();
  const props = {
    editor,
    readOnly: false,
    trackChangesOn: false,
    cellShading: '#ffffff',
    setCellShading: jest.fn(),
    tableShading: '#ffffff',
    setTableShading: jest.fn(),
    ...overrides
  };
  const view = render(<TableGroup {...props} />);
  return { editor, props, view };
}

describe('TableGroup', () => {
  it('drives row operations through the Syncfusion editor API', () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTitle('Table rows'));

    fireEvent.click(screen.getByText('Insert row above'));
    expect(editor.editor.insertRow).toHaveBeenCalledWith(true, 1);

    fireEvent.click(screen.getByTitle('Table rows'));
    fireEvent.click(screen.getByText('Insert row below'));
    expect(editor.editor.insertRow).toHaveBeenCalledWith(false, 1);

    fireEvent.click(screen.getByTitle('Table rows'));
    fireEvent.click(screen.getByText('Delete row'));
    expect(editor.editor.deleteRow).toHaveBeenCalled();
  });

  it('drives column operations through the Syncfusion editor API', () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTitle('Table columns'));

    fireEvent.click(screen.getByText('Insert column left'));
    expect(editor.editor.insertColumn).toHaveBeenCalledWith(true, 1);

    fireEvent.click(screen.getByTitle('Table columns'));
    fireEvent.click(screen.getByText('Insert column right'));
    expect(editor.editor.insertColumn).toHaveBeenCalledWith(false, 1);

    fireEvent.click(screen.getByTitle('Table columns'));
    fireEvent.click(screen.getByText('Delete column'));
    expect(editor.editor.deleteColumn).toHaveBeenCalled();
  });

  it('merges cells and deletes the table', () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTitle('Merge cells'));
    expect(editor.editor.mergeCells).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Delete table'));
    expect(editor.editor.deleteTable).toHaveBeenCalled();
  });

  it('applies each border preset with its BorderType', () => {
    const { editor } = renderGroup();
    for (const [label, type] of [
      ['All borders', 'AllBorders'],
      ['Outside borders', 'OutsideBorders'],
      ['Inside borders', 'InsideBorders'],
      ['No borders', 'NoBorder']
    ]) {
      fireEvent.click(screen.getByTitle('Borders'));
      fireEvent.click(screen.getByText(label));
      expect(editor.editor.applyBorders).toHaveBeenCalledWith({ type });
    }
  });

  it('writes shading to the right scope and mirrors local state', () => {
    const { editor, props } = renderGroup();

    const cellInput = screen
      .getByTitle('Cell shading')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(cellInput, { target: { value: '#ff0000' } });
    expect(props.setCellShading).toHaveBeenCalledWith('#ff0000');
    expect(editor.selection.cellFormat.background).toBe('#ff0000');
    expect(editor.selection.tableFormat.background).toBeUndefined();

    const tableInput = screen
      .getByTitle('Table shading')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(tableInput, { target: { value: '#00ff00' } });
    expect(props.setTableShading).toHaveBeenCalledWith('#00ff00');
    expect(editor.selection.tableFormat.background).toBe('#00ff00');
  });

  it('gates untracked structural ops while track changes is on', () => {
    const { editor } = renderGroup({ trackChangesOn: true });

    // Direct buttons disabled with the explanatory tooltip.
    const merge = screen.getByTitle(/Merge cells — /);
    const del = screen.getByTitle(/Delete table — /);
    expect(merge).toBeDisabled();
    expect(del).toBeDisabled();
    fireEvent.click(merge);
    fireEvent.click(del);
    expect(editor.editor.mergeCells).not.toHaveBeenCalled();
    expect(editor.editor.deleteTable).not.toHaveBeenCalled();

    // Tracked-safe row inserts stay enabled; delete row is gated.
    fireEvent.click(screen.getByTitle('Table rows'));
    expect(screen.getByText('Insert row above')).toBeEnabled();
    expect(screen.getByText('Delete row')).toBeDisabled();
    fireEvent.click(screen.getByText('Insert row above'));
    expect(editor.editor.insertRow).toHaveBeenCalledWith(true, 1);

    // Every column op is gated.
    fireEvent.click(screen.getByTitle('Table columns'));
    for (const label of [
      'Insert column left',
      'Insert column right',
      'Delete column'
    ]) {
      const item = screen.getByText(label);
      expect(item).toBeDisabled();
      fireEvent.click(item);
    }
    expect(editor.editor.insertColumn).not.toHaveBeenCalled();
    expect(editor.editor.deleteColumn).not.toHaveBeenCalled();
  });

  it('disables everything in read-only mode', () => {
    renderGroup({ readOnly: true });
    for (const title of [
      'Table rows',
      'Table columns',
      'Merge cells',
      'Borders',
      'Delete table'
    ]) {
      expect(screen.getByTitle(title)).toBeDisabled();
    }
    expect(
      screen.getByTitle('Cell shading').querySelector('input')
    ).toBeDisabled();
    expect(
      screen.getByTitle('Table shading').querySelector('input')
    ).toBeDisabled();
  });
});

import { render, waitFor, fireEvent } from '@testing-library/react';
import { TABLE_CLASS } from '../TableElement/classNames';
import ResponsiveStyles from '../../styles';

const mockResponsiveStyles = {
  addTargets: jest.fn().mockReturnThis(),
  apply: jest.fn(),
  applyCorners: jest.fn(),
  applyWidth: jest.fn(),
  getTarget: jest.fn().mockReturnValue({})
};

const column = (name: string, key: string) => ({
  name,
  field_id: key,
  field_type: 'text',
  field_key: key
});

const baseColumns = [column('Name', 'f1'), column('Email', 'f2')];

async function renderTable(properties: Record<string, any>, editMode = true) {
  const TableElement = (await import('../TableElement')).default;
  return render(
    <TableElement
      element={{ id: 'tbl', properties }}
      responsiveStyles={mockResponsiveStyles}
      editMode={editMode}
    />
  );
}

describe('TableElement targetable class names', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies structural, toolbar, editing and pagination classes', async () => {
    // editMode populates two rows of example data; pagination=1 -> 2 pages.
    const { container } = await renderTable({
      columns: baseColumns,
      actions: [],
      search: true,
      sort: true,
      pagination: 1,
      enable_editing: true,
      add_delete_rows: true
    });

    const expected = [
      TABLE_CLASS.container,
      TABLE_CLASS.toolbar,
      TABLE_CLASS.search,
      TABLE_CLASS.searchInput,
      TABLE_CLASS.addRowButton,
      TABLE_CLASS.table,
      TABLE_CLASS.header,
      TABLE_CLASS.headerCell,
      TABLE_CLASS.sortIcon,
      TABLE_CLASS.body,
      TABLE_CLASS.row,
      TABLE_CLASS.cell,
      TABLE_CLASS.editableCell,
      TABLE_CLASS.deleteButton,
      TABLE_CLASS.pagination,
      TABLE_CLASS.pageButton
    ];

    await waitFor(() => {
      expect(container.querySelector(`.${TABLE_CLASS.table}`)).toBeTruthy();
    });

    expected.forEach((className) => {
      expect(container.querySelector(`.${className}`)).toBeTruthy();
    });
  });

  it('applies the inline action button class for a single row action', async () => {
    const { container } = await renderTable({
      columns: baseColumns,
      actions: [{ label: 'View' }],
      search: false,
      sort: false,
      pagination: 0
    });

    await waitFor(() => {
      expect(
        container.querySelector(`.${TABLE_CLASS.actionButton}`)
      ).toBeTruthy();
    });
  });

  it('applies menu classes to the trigger, dropdown and items when actions overflow', async () => {
    const { container, baseElement } = await renderTable({
      columns: baseColumns,
      actions: [{ label: 'View' }, { label: 'Edit' }],
      search: false,
      sort: false,
      pagination: 0
    });

    let trigger: Element | null = null;
    await waitFor(() => {
      trigger = container.querySelector(`.${TABLE_CLASS.actionMenuButton}`);
      expect(trigger).toBeTruthy();
    });

    fireEvent.click(trigger!);

    // The dropdown renders through a portal into document.body
    await waitFor(() => {
      expect(
        baseElement.querySelector(`.${TABLE_CLASS.actionMenu}`)
      ).toBeTruthy();
    });
    expect(
      baseElement.querySelectorAll(`.${TABLE_CLASS.actionMenuItem}`).length
    ).toBeGreaterThanOrEqual(2);
  });

  it('tags header and body cells with their column field key', async () => {
    // Form mode reads real field values; editMode swaps in example keys
    const { fieldValues } = await import('../../../utils/init');
    fieldValues.f1 = ['Alice'];
    fieldValues.f2 = ['alice@example.com'];

    try {
      const { container } = await renderTable(
        {
          columns: baseColumns,
          actions: [],
          search: false,
          sort: true,
          pagination: 0
        },
        false
      );

      await waitFor(() => {
        expect(container.querySelector(`.${TABLE_CLASS.table}`)).toBeTruthy();
      });

      ['f1', 'f2'].forEach((fieldKey) => {
        expect(
          container.querySelector(
            `.${TABLE_CLASS.headerCell}[data-feathery-field="${fieldKey}"]`
          )
        ).toBeTruthy();
        expect(
          container.querySelector(
            `.${TABLE_CLASS.cell}[data-feathery-field="${fieldKey}"]`
          )
        ).toBeTruthy();
      });
    } finally {
      delete fieldValues.f1;
      delete fieldValues.f2;
    }
  });

  async function renderWithStyles(styles: Record<string, any>) {
    const TableElement = (await import('../TableElement')).default;
    return render(
      <TableElement
        element={{
          id: 'tbl',
          properties: { columns: baseColumns, actions: [], pagination: 0 },
          styles
        }}
        responsiveStyles={mockResponsiveStyles}
        editMode
      />
    );
  }

  it('emits an unsized colgroup for equal columns', async () => {
    const { container } = await renderWithStyles({ column_sizing: 'equal' });

    let colgroup: Element | null = null;
    await waitFor(() => {
      colgroup = container.querySelector('colgroup');
      expect(colgroup).toBeTruthy();
    });

    // No explicit widths -> table-layout: fixed shares the space equally.
    const cols = colgroup!.querySelectorAll('col');
    expect(cols.length).toBe(2);
    cols.forEach((col) => expect((col as HTMLElement).style.width).toBe(''));
  });

  it('does not render a colgroup in the default (auto) sizing', async () => {
    const { container } = await renderTable({
      columns: baseColumns,
      actions: [],
      pagination: 0
    });

    await waitFor(() => {
      expect(container.querySelector(`.${TABLE_CLASS.table}`)).toBeTruthy();
    });
    expect(container.querySelector('colgroup')).toBeFalsy();
  });

  const MOBILE_MEDIA = '@media (max-width: 478px)';

  // Uses a real ResponsiveStyles so the per-viewport table-layout is resolved
  // through the responsive style path (desktop value + a mobile media query),
  // exactly as it renders in a live form.
  async function renderResponsive(
    styles: Record<string, any>,
    mobileStyles: Record<string, any>,
    propsOverride: Record<string, any> = {}
  ) {
    const TableElement = (await import('../TableElement')).default;
    const responsiveStyles = new ResponsiveStyles(
      { styles, mobile_styles: mobileStyles },
      ['container', 'table'],
      true
    );
    const result = render(
      <TableElement
        element={{
          id: 'tbl',
          properties: {
            columns: baseColumns,
            actions: [],
            pagination: 0,
            ...propsOverride
          },
          styles,
          mobile_styles: mobileStyles
        }}
        responsiveStyles={responsiveStyles}
        editMode
      />
    );
    await waitFor(() => {
      expect(
        result.container.querySelector(`.${TABLE_CLASS.table}`)
      ).toBeTruthy();
    });
    return { ...result, responsiveStyles };
  }

  it('keeps desktop equal fixed while mobile auto resets it via media query', async () => {
    const { container, responsiveStyles } = await renderResponsive(
      { column_sizing: 'equal' },
      { column_sizing: 'auto' }
    );

    // Colgroup renders because at least one viewport is equal.
    expect(container.querySelector('colgroup')).toBeTruthy();

    const table = responsiveStyles.getTarget('table');
    expect(table.tableLayout).toBe('fixed');
    expect(table[MOBILE_MEDIA].tableLayout).toBe('auto');
  });

  it('enables fixed layout on mobile even when desktop is auto', async () => {
    const { container, responsiveStyles } = await renderResponsive(
      { column_sizing: 'auto' },
      { column_sizing: 'equal' }
    );

    // Previously desktop-auto skipped fixed layout entirely, so mobile equal
    // was ignored; the colgroup and the mobile media query must both appear.
    expect(container.querySelector('colgroup')).toBeTruthy();

    const table = responsiveStyles.getTarget('table');
    expect(table.tableLayout).toBe('auto');
    expect(table[MOBILE_MEDIA].tableLayout).toBe('fixed');
  });

  it('does not pin the action column in the viewport that is still auto', async () => {
    // Desktop auto + mobile equal still renders the colgroup (the DOM can't be
    // media-queried), so the action column's fixed width has to be scoped to
    // mobile or it constrains the auto desktop layout too.
    const { container } = await renderResponsive(
      { column_sizing: 'auto' },
      { column_sizing: 'equal' },
      { actions: [{ type: 'button', label: 'Go' }] }
    );

    const cols = container.querySelectorAll('colgroup col');
    const actionCol = cols[cols.length - 1] as HTMLElement;
    const rules = getComputedStyle(actionCol);
    expect(rules.width).toBe('auto');
  });

  it('drops fixed layout when row data turns the table transposed', async () => {
    // isTransposed tracks the row count, so it flips after the element has
    // already rendered. The style target is memoized per element, so a stale
    // 'fixed' would survive onto the transposed table.
    const TableElement = (await import('../TableElement')).default;
    const styles = { column_sizing: 'equal' };
    const responsiveStyles = new ResponsiveStyles(
      { styles, mobile_styles: {} },
      ['container', 'table'],
      true
    );
    const element = (transpose: boolean) => ({
      id: 'tbl',
      properties: {
        columns: baseColumns,
        actions: [],
        pagination: 0,
        transpose
      },
      styles,
      mobile_styles: {}
    });

    const { rerender, container } = render(
      <TableElement
        element={element(false)}
        responsiveStyles={responsiveStyles}
        editMode
      />
    );
    await waitFor(() => {
      expect(container.querySelector(`.${TABLE_CLASS.table}`)).toBeTruthy();
    });
    expect(responsiveStyles.getTarget('table').tableLayout).toBe('fixed');

    rerender(
      <TableElement
        element={element(true)}
        responsiveStyles={responsiveStyles}
        editMode
      />
    );
    await waitFor(() => {
      expect(container.querySelector('colgroup')).toBeFalsy();
    });
    expect(responsiveStyles.getTarget('table').tableLayout).toBe('auto');
  });

  it('applies the empty state class when there is no data', async () => {
    // Form mode with no field values renders the empty state.
    const { container } = await renderTable(
      {
        columns: baseColumns,
        actions: [],
        search: false,
        sort: false,
        pagination: 0
      },
      false
    );

    await waitFor(() => {
      expect(container.querySelector(`.${TABLE_CLASS.empty}`)).toBeTruthy();
    });
  });
});

describe('TableElement DOM naming', () => {
  it('names the table container', async () => {
    const { container } = await renderTable({
      columns: baseColumns,
      actions: []
    });
    expect(
      container.querySelector(`.${TABLE_CLASS.container}`)?.getAttribute('name')
    ).toBe('table');
  });
});

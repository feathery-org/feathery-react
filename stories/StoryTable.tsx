import React from 'react';
import Elements from '../src/elements';
import { fieldValues } from '../src/utils/init';

// A live table reads its rows from the form's field values: each column is
// bound to a repeating field whose value is an array, one entry per row. In
// editMode the table ignores them and shows the builder's example rows.
const COLUMNS = [
  {
    name: 'Name',
    field_id: 'f-name',
    field_type: 'text_field',
    field_key: 'story_table_name'
  },
  {
    name: 'Email',
    field_id: 'f-email',
    field_type: 'email',
    field_key: 'story_table_email'
  },
  {
    name: 'Role',
    field_id: 'f-role',
    field_type: 'text_field',
    field_key: 'story_table_role'
  }
];

const SAMPLE_ROWS: Record<string, any[]> = {
  story_table_name: [
    'Ada Lovelace',
    'Grace Hopper',
    'Alan Turing',
    'Katherine Johnson'
  ],
  story_table_email: [
    'ada@example.com',
    'grace@example.com',
    'alan@example.com',
    'katherine@example.com'
  ],
  story_table_role: ['Engineer', 'Admiral', 'Researcher', 'Mathematician']
};

// Seeded once per load, so edits survive re-renders from the controls. Every
// story showing a table shares these rows, as fields on one form would.
Object.entries(SAMPLE_ROWS).forEach(([key, rows]) => {
  if (fieldValues[key] === undefined) fieldValues[key] = [...rows];
});

export interface TableOptions {
  displayMode?: 'classic' | 'spreadsheet';
  enableEditing?: boolean;
  addDeleteRows?: boolean;
  search?: boolean;
  sort?: boolean;
  /** Rows per page, 0 for no pagination */
  pagination?: number;
  /** Fixed height in px, 0 to fit the rows */
  height?: number;
}

export function tableElement({
  displayMode = 'classic',
  enableEditing = true,
  addDeleteRows = true,
  search = true,
  sort = true,
  pagination = 0,
  height = 0
}: TableOptions = {}) {
  return {
    id: 'story-table',
    type: 'table',
    styles: height ? { height, height_unit: 'px' } : {},
    mobile_styles: {},
    properties: {
      columns: COLUMNS,
      actions: [],
      display_mode: displayMode,
      enable_editing: enableEditing,
      add_delete_rows: addDeleteRows,
      search,
      sort,
      pagination,
      transpose: false
    }
  };
}

export function StoryTable({
  element,
  editMode,
  onSubmit
}: {
  element: ReturnType<typeof tableElement>;
  editMode?: string;
  onSubmit?: (values: Record<string, any>) => void;
}) {
  return (
    <Elements.TableElement
      // Remount on mode switches: the table keeps its data in hooks keyed off
      // the mode it mounted in
      key={`${editMode}-${element.properties.display_mode}`}
      element={element}
      editMode={editMode}
      // What the form does with a table's writes: store them as the columns'
      // field values
      updateFieldValues={(values: Record<string, any>) =>
        Object.assign(fieldValues, values)
      }
      submitCustom={(values: Record<string, any>) => {
        Object.assign(fieldValues, values);
        onSubmit?.(values);
      }}
    />
  );
}

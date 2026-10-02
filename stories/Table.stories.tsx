import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';
import { StoryTable, tableElement, TableOptions } from './StoryTable';
import { editModeArgType, EditModeArgs } from './theme/storyHelpers';

type Args = EditModeArgs &
  Required<TableOptions> & {
    submitCustom: (values: Record<string, any>) => void;
  };

const meta: Meta<Args> = {
  title: 'Elements/Table',
  args: {
    displayMode: 'classic',
    enableEditing: true,
    addDeleteRows: true,
    search: true,
    sort: true,
    pagination: 0,
    height: 0,
    submitCustom: fn()
  },
  argTypes: {
    ...editModeArgType,
    displayMode: {
      control: 'inline-radio',
      options: ['classic', 'spreadsheet']
    },
    pagination: { control: { type: 'range', min: 0, max: 5 } },
    height: { control: { type: 'range', min: 0, max: 600, step: 20 } }
  },
  render: ({ editMode, submitCustom, ...options }) => (
    <div style={{ maxWidth: 720, height: options.height || undefined }}>
      <StoryTable
        element={tableElement(options)}
        editMode={editMode}
        onSubmit={submitCustom}
      />
    </div>
  )
};

export default meta;
type Story = StoryObj<Args>;

/** A live form's table, over the seeded rows */
export const Live: Story = {};
